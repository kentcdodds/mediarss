import { readFileSync } from 'node:fs'
import path from 'node:path'

let cached: Buffer | null = null

/**
 * Bytes for a small PNG used when no real artwork exists for podcast-facing URLs.
 * SVG placeholders are not reliably rendered by podcast clients for itunes:image.
 */
export function getPodcastArtPlaceholderBytes(): Buffer {
	if (!cached) {
		const filePath = path.resolve(
			import.meta.dirname,
			'../assets/podcast-art-placeholder.png',
		)
		cached = readFileSync(filePath)
	}
	return cached
}

/** Body for `Response` (assert: TS `BodyInit` vs `Uint8Array` buffer typing mismatch). */
export function getPodcastArtPlaceholderBody(): BodyInit {
	return new Uint8Array(getPodcastArtPlaceholderBytes()) as BodyInit
}

export const PODCAST_ART_PLACEHOLDER_CONTENT_TYPE = 'image/png'
