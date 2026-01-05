import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { listActiveCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import { listActiveDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import { listDirectoryFeeds } from '#app/db/directory-feeds.ts'

/**
 * GET /admin/api/feeds
 * Returns all feeds (directory and curated) with their active token counts.
 */
export default {
	middleware: [],
	action() {
		const directoryFeeds = listDirectoryFeeds().map((feed) => ({
			...feed,
			type: 'directory' as const,
			tokenCount: listActiveDirectoryFeedTokens(feed.id).length,
		}))

		const curatedFeeds = listCuratedFeeds().map((feed) => ({
			...feed,
			type: 'curated' as const,
			tokenCount: listActiveCuratedFeedTokens(feed.id).length,
		}))

		return Response.json({
			directoryFeeds,
			curatedFeeds,
		})
	},
} satisfies Action<
	typeof routes.adminApiFeeds.method,
	typeof routes.adminApiFeeds.pattern.source
>
