/**
 * Public RSS feed URL helpers.
 *
 * Feed access is token-only. The working public path is `/feed/{token}`.
 * The feed id never appears in the URL; a `?token=` query string is not valid
 * and 404s.
 */

import routes from '#app/config/routes.ts'

/**
 * Relative RSS path for a feed access token.
 * Example: `/feed/ZmayrMaOueHNO_lKU0Nc16k6xxT7p3kA4MAkqGldf7c`
 */
export function buildFeedRssPath(token: string): string {
	return routes.feed.href({ token })
}

/**
 * Absolute RSS URL for a feed access token.
 * Example: `https://mediarss.example/feed/{token}`
 */
export function buildFeedRssUrl(baseUrl: string, token: string): string {
	return `${baseUrl}${buildFeedRssPath(token)}`
}

/**
 * Display name for a token label. Empty or whitespace-only labels are unlabeled.
 */
export function displayTokenLabel(label: string | null | undefined): string {
	const trimmed = label?.trim() ?? ''
	return trimmed.length > 0 ? trimmed : 'Unlabeled'
}
