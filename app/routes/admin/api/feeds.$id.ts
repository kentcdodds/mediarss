import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { listActiveCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import { listDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import { getDirectoryFeedById } from '#app/db/directory-feeds.ts'

/**
 * GET /admin/api/feeds/:id
 * Returns a single feed with its tokens.
 */
export default {
	middleware: [],
	action(context) {
		const { id } = context.params

		// Try directory feed first
		const directoryFeed = getDirectoryFeedById(id)
		if (directoryFeed) {
			const tokens = listDirectoryFeedTokens(directoryFeed.id)
			return Response.json({
				feed: { ...directoryFeed, type: 'directory' as const },
				tokens,
			})
		}

		// Try curated feed
		const curatedFeed = getCuratedFeedById(id)
		if (curatedFeed) {
			const tokens = listActiveCuratedFeedTokens(curatedFeed.id)
			return Response.json({
				feed: { ...curatedFeed, type: 'curated' as const },
				tokens,
			})
		}

		return Response.json({ error: 'Feed not found' }, { status: 404 })
	},
} satisfies Action<
	typeof routes.adminApiFeed.method,
	typeof routes.adminApiFeed.pattern.source
>
