import { getFeedArtworkPath } from '#app/helpers/feed-artwork.ts'
import { type MediaFile } from '#app/helpers/media.ts'
import { PODCAST_ART_PLACEHOLDER_CONTENT_TYPE } from '#app/helpers/podcast-art-placeholder.ts'

/**
 * Uploaded feed artwork MIME only (no embedded/placeholder fallback).
 * Used when computing per-item fallbacks that should not use another
 * item's embedded art.
 */
export async function getUploadedFeedArtworkMimeType(
	feedId: string,
): Promise<string | null> {
	const uploadedArtwork = await getFeedArtworkPath(feedId)
	return uploadedArtwork?.mimeType ?? null
}

/**
 * Resolve the MIME type that feed-level `/art/.../feed` will serve.
 *
 * Mirrors the resolveFeedArtwork fallback chain without loading/squaring
 * image bytes:
 * 1. Uploaded feed artwork
 * 2. First feed item with embedded artwork
 * 3. PNG placeholder
 */
export function resolveFeedArtworkMimeType(params: {
	uploadedFeedArtworkMimeType: string | null
	items: Array<MediaFile>
}): string {
	if (params.uploadedFeedArtworkMimeType) {
		return params.uploadedFeedArtworkMimeType
	}

	for (const item of params.items) {
		if (item.artworkMimeType) {
			return item.artworkMimeType
		}
	}

	return PODCAST_ART_PLACEHOLDER_CONTENT_TYPE
}
