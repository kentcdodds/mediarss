import { toAbsolutePath } from '#app/config/env.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'
import { getFeedArtworkPath } from '#app/helpers/feed-artwork.ts'
import {
	getPodcastArtPlaceholderBytes,
	PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
} from '#app/helpers/podcast-art-placeholder.ts'
import {
	getFileArtworkSourceKey,
	getSquareArtwork,
	getSquareArtworkFromFile,
} from '#app/helpers/square-artwork.ts'

/**
 * Resolve artwork for a feed with fallback chain:
 * 1. Uploaded artwork (if exists)
 * 2. First item's embedded artwork
 * 3. Generated placeholder PNG (podcast clients often ignore SVG)
 */
export async function resolveFeedArtwork(feedId: string): Promise<Response> {
	// Priority 1: Uploaded artwork
	const uploadedArtwork = await getFeedArtworkPath(feedId)
	if (uploadedArtwork) {
		try {
			const squareArtwork = await getSquareArtworkFromFile({
				filePath: uploadedArtwork.path,
				mimeType: uploadedArtwork.mimeType,
			})
			return new Response(new Uint8Array(squareArtwork.data), {
				headers: {
					'Content-Type': squareArtwork.mimeType,
					'Cache-Control': 'public, max-age=86400',
				},
			})
		} catch (error) {
			console.error(
				`Failed to square uploaded feed artwork for feed ${feedId}:`,
				error,
			)
		}
	}

	// Priority 2: First item's embedded artwork
	const feedItems = await getItemsForFeed(feedId)
	if (feedItems.length > 0) {
		const firstItem = feedItems[0]!
		const filePath = toAbsolutePath(firstItem.mediaRoot, firstItem.relativePath)
		if (filePath) {
			const itemArtwork = await extractArtwork(filePath)
			if (itemArtwork) {
				try {
					const embeddedSourceKey = await getFileArtworkSourceKey(filePath)
					const squareArtwork = await getSquareArtwork({
						data: itemArtwork.data,
						mimeType: itemArtwork.mimeType,
						sourceKey: `embedded:${feedId}:${embeddedSourceKey}`,
					})
					return new Response(new Uint8Array(squareArtwork.data), {
						headers: {
							'Content-Type': squareArtwork.mimeType,
							'Cache-Control': 'public, max-age=86400',
						},
					})
				} catch (error) {
					console.error(
						`Failed to square embedded feed artwork for ${filePath}:`,
						error,
					)
				}
			}
		}
	}

	// Priority 3: Raster placeholder (SVG is poorly supported in podcast apps)
	return new Response(new Uint8Array(getPodcastArtPlaceholderBytes()), {
		headers: {
			'Content-Type': PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
			'Cache-Control': 'public, max-age=86400',
		},
	})
}
