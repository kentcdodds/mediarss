import type { Action } from 'remix/fetch-router'
import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listActiveCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import { listActiveDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import {
	listDirectoryFeeds,
	parseDirectoryPaths,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import { scanDirectory } from '#app/helpers/media.ts'

/**
 * Get the most recent lastUsedAt from a list of tokens.
 */
function getLastAccessedAt(
	tokens: Array<{ lastUsedAt: number | null }>,
): number | null {
	const usedTokens = tokens.filter((t) => t.lastUsedAt !== null)
	if (usedTokens.length === 0) return null
	return Math.max(...usedTokens.map((t) => t.lastUsedAt!))
}

/**
 * GET /admin/api/feeds
 * Returns all feeds (directory and curated) with item counts and last accessed times.
 */
export default {
	middleware: [],
	async action() {
		// Process directory feeds
		const directoryFeedsList = listDirectoryFeeds()
		const directoryFeeds = await Promise.all(
			directoryFeedsList.map(async (feed) => {
				const tokens = listActiveDirectoryFeedTokens(feed.id)
				const paths = parseDirectoryPaths(feed)

				// Count files across all directories (uses cached scan)
				let itemCount = 0
				for (const mediaPath of paths) {
					const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
					const absolutePath = toAbsolutePath(mediaRoot, relativePath)
					if (absolutePath) {
						const files = await scanDirectory(absolutePath)
						itemCount += files.length
					}
				}

				return {
					...feed,
					type: 'directory' as const,
					tokenCount: tokens.length,
					itemCount,
					lastAccessedAt: getLastAccessedAt(tokens),
				}
			}),
		)

		// Process curated feeds
		const curatedFeedsList = listCuratedFeeds()
		const curatedFeeds = curatedFeedsList.map((feed) => {
			const tokens = listActiveCuratedFeedTokens(feed.id)
			const items = getItemsForFeed(feed.id)

			return {
				...feed,
				type: 'curated' as const,
				tokenCount: tokens.length,
				itemCount: items.length,
				lastAccessedAt: getLastAccessedAt(tokens),
			}
		})

		return Response.json({
			directoryFeeds,
			curatedFeeds,
		})
	},
} satisfies Action<
	typeof routes.adminApiFeeds.method,
	typeof routes.adminApiFeeds.pattern.source
>
