import { toAbsolutePath } from '#app/config/env.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import { type Feed } from '#app/db/types.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'
import { getFeedArtworkPath } from '#app/helpers/feed-artwork.ts'
import { getFileResponse } from '#app/helpers/node-file.ts'
import {
	getPodcastArtPlaceholderBody,
	PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
} from '#app/helpers/podcast-art-placeholder.ts'

/**
 * Resolve artwork for a feed with fallback chain:
 * 1. Uploaded artwork (if exists)
 * 2. External imageUrl (redirect)
 * 3. First item's embedded artwork
 * 4. Generated placeholder PNG (podcast clients often ignore SVG)
 */
export async function resolveFeedArtwork(
	feedId: string,
	feed: Feed,
	request: Request,
): Promise<Response> {
	// Priority 1: Uploaded artwork
	const uploadedArtwork = await getFeedArtworkPath(feedId)
	if (uploadedArtwork) {
		const response = await getFileResponse(uploadedArtwork.path, request, {
			cacheControl: 'public, max-age=86400',
			contentType: uploadedArtwork.mimeType,
			conditionalResponses: false,
		})
		if (response) {
			return response
		}
	}

	// Priority 2: External imageUrl (redirect)
	if (feed.imageUrl) {
		return new Response(null, {
			status: 302,
			headers: { Location: feed.imageUrl },
		})
	}

	// Priority 3: First item's embedded artwork
	const feedItems = await getItemsForFeed(feedId)
	if (feedItems.length > 0) {
		const firstItem = feedItems[0]!
		const filePath = toAbsolutePath(firstItem.mediaRoot, firstItem.relativePath)
		if (filePath) {
			const itemArtwork = await extractArtwork(filePath)
			if (itemArtwork) {
				return new Response(new Uint8Array(itemArtwork.data), {
					headers: {
						'Content-Type': itemArtwork.mimeType,
						'Cache-Control': 'public, max-age=86400',
					},
				})
			}
		}
	}

	// Priority 4: Raster placeholder (SVG is poorly supported in podcast apps)
	const png = getPodcastArtPlaceholderBody()
	return new Response(png, {
		headers: {
			'Content-Type': PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
			'Cache-Control': 'public, max-age=86400',
		},
	})
}
