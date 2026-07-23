/**
 * Podcast client-facing artwork URL helpers.
 *
 * Apple Podcasts / Pocket Casts (and similar clients) often require artwork
 * URLs to end with a real image extension such as `.jpg`. Cache-bust tokens
 * therefore live in the path (`/v/{version}/...jpg`) rather than a `?v=` query
 * string that would make the URL no longer end in an image extension.
 */

const PODCAST_ART_IMAGE_EXTENSION = '.jpg'
const TRAILING_IMAGE_EXTENSION_RE = /\.(?:jpe?g|png|webp)$/i
const CACHE_VERSION_PREFIX_RE = /^v\/(\d+)\//

/**
 * Build the channel/feed artwork URL for an RSS feed.
 * Format: /art/:token/v/:cacheVersion/feed.jpg
 */
export function buildFeedPodcastArtUrl(
	baseUrl: string,
	token: string,
	cacheVersion: number,
): string {
	return `${baseUrl}/art/${token}/v/${cacheVersion}/feed${PODCAST_ART_IMAGE_EXTENSION}`
}

/**
 * Build an episode/item artwork URL for an RSS feed.
 * Format: /art/:token/v/:cacheVersion/:rootName/:encodedRelativePath.jpg
 */
export function buildItemPodcastArtUrl(
	baseUrl: string,
	token: string,
	rootName: string,
	relativePath: string,
	cacheVersion: number,
): string {
	const encodedRelativePath = encodeURIComponent(relativePath)
	return `${baseUrl}/art/${token}/v/${cacheVersion}/${rootName}/${encodedRelativePath}${PODCAST_ART_IMAGE_EXTENSION}`
}

/**
 * Strip optional podcast-art decorations from an `/art/:token/*path` splat.
 *
 * Accepts both the new decorated URLs and legacy undecorated paths:
 * - trailing `.jpg` / `.jpeg` / `.png` / `.webp`
 * - leading `v/{cacheVersion}/` cache-bust segment
 */
export function normalizePodcastArtPath(splatParam: string): string {
	const withoutExtension = splatParam.replace(TRAILING_IMAGE_EXTENSION_RE, '')
	return withoutExtension.replace(CACHE_VERSION_PREFIX_RE, '')
}
