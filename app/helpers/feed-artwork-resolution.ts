import { toAbsolutePath } from '#app/config/env.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { Feed } from '#app/db/types.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'
import { getFeedArtworkPath } from '#app/helpers/feed-artwork.ts'
import { generatePlaceholderSvg } from '#app/helpers/placeholder-svg.ts'

/**
 * Resolve artwork for a feed with fallback chain:
 * 1. Uploaded artwork (if exists)
 * 2. External imageUrl (redirect)
 * 3. First item's embedded artwork
 * 4. Generated placeholder SVG
 */
export async function resolveFeedArtwork(
	feedId: string,
	feed: Feed,
): Promise<Response> {
	// Priority 1: Uploaded artwork
	const uploadedArtwork = await getFeedArtworkPath(feedId)
	if (uploadedArtwork) {
		const artworkFile = Bun.file(uploadedArtwork.path)
		return new Response(artworkFile.stream(), {
			headers: {
				'Content-Type': uploadedArtwork.mimeType,
				'Cache-Control': 'public, max-age=86400',
			},
		})
	}

	// Priority 2: External imageUrl (redirect)
	if (feed.imageUrl) {
		return new Response(null, {
			status: 302,
			headers: { Location: feed.imageUrl },
		})
	}

	// Priority 3: First item's embedded artwork
	const feedItems = getItemsForFeed(feedId)
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

	// Priority 4: Generated placeholder SVG
	const svg = generatePlaceholderSvg(feed.name)
	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=86400',
		},
	})
}
