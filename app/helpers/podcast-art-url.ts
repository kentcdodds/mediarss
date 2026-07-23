/**
 * Podcast client-facing artwork URL helpers.
 *
 * Apple Podcasts / Pocket Casts (and similar clients) often require artwork
 * URLs to end with a real image extension such as `.jpg`. Cache-bust tokens
 * therefore live in the path (`/v/{version}/...jpg`) rather than a `?v=` query
 * string that would make the URL no longer end in an image extension.
 *
 * The extension matches the format `/art` will serve after squaring
 * (JPEG / PNG / WebP), not the underlying media file's audio extension.
 */

import { getArtworkOutputFormat } from '#app/helpers/square-artwork.ts'

const TRAILING_IMAGE_EXTENSION_RE = /\.(?:jpe?g|png|webp)$/i
const CACHE_VERSION_PREFIX_RE = /^v\/(\d+)\//

export type PodcastArtImageExtension = 'jpg' | 'png' | 'webp'

/**
 * Choose the podcast-art URL extension for a source artwork MIME type.
 */
export function getPodcastArtExtension(
	mimeType: string,
): PodcastArtImageExtension {
	return getArtworkOutputFormat(mimeType).ext
}

/**
 * Build the channel/feed artwork URL for an RSS feed.
 * Format: /art/:token/v/:cacheVersion/feed.{jpg|png|webp}
 */
export function buildFeedPodcastArtUrl(
	baseUrl: string,
	token: string,
	cacheVersion: number,
	artworkMimeType: string,
): string {
	const ext = getPodcastArtExtension(artworkMimeType)
	return `${baseUrl}/art/${token}/v/${cacheVersion}/feed.${ext}`
}

/**
 * Build an episode/item artwork URL for an RSS feed.
 * Format: /art/:token/v/:cacheVersion/:rootName/:encodedRelativePath.{jpg|png|webp}
 */
export function buildItemPodcastArtUrl(
	baseUrl: string,
	token: string,
	rootName: string,
	relativePath: string,
	cacheVersion: number,
	artworkMimeType: string,
): string {
	const encodedRelativePath = encodeURIComponent(relativePath)
	const ext = getPodcastArtExtension(artworkMimeType)
	return `${baseUrl}/art/${token}/v/${cacheVersion}/${rootName}/${encodedRelativePath}.${ext}`
}

/**
 * Strip optional podcast-art decorations from an `/art/:token/*path` splat.
 *
 * Accepts both the new decorated URLs and legacy undecorated paths:
 * - trailing `.jpg` / `.jpeg` / `.png` / `.webp`
 * - leading `v/{cacheVersion}/` cache-bust segment (only when an image
 *   extension was present, so a legacy media root named `v` is not mangled)
 */
export function normalizePodcastArtPath(splatParam: string): string {
	const hadImageExtension = TRAILING_IMAGE_EXTENSION_RE.test(splatParam)
	const withoutExtension = splatParam.replace(TRAILING_IMAGE_EXTENSION_RE, '')
	if (!hadImageExtension) {
		return withoutExtension
	}
	return withoutExtension.replace(CACHE_VERSION_PREFIX_RE, '')
}
