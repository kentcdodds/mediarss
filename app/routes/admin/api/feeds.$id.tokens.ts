import type { BuildAction } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import { getDirectoryFeedById } from '#app/db/directory-feeds.ts'

type CreateTokenRequest = {
	label?: string
}

/**
 * POST /admin/api/feeds/:id/tokens
 * Creates a new token for a feed.
 */
export default {
	middleware: [],
	async action(context) {
		if (context.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		const { id } = context.params

		let body: CreateTokenRequest = {}
		try {
			body = await context.request.json()
		} catch {
			// Body is optional, default to empty object
		}

		// Try directory feed first
		const directoryFeed = getDirectoryFeedById(id)
		if (directoryFeed) {
			const token = createDirectoryFeedToken({
				feedId: directoryFeed.id,
				label: body.label,
			})
			return Response.json(token, { status: 201 })
		}

		// Try curated feed
		const curatedFeed = getCuratedFeedById(id)
		if (curatedFeed) {
			const token = createCuratedFeedToken({
				feedId: curatedFeed.id,
				label: body.label,
			})
			return Response.json(token, { status: 201 })
		}

		return Response.json({ error: 'Feed not found' }, { status: 404 })
	},
} satisfies BuildAction<
	typeof routes.adminApiFeedTokens.method,
	typeof routes.adminApiFeedTokens.pattern
>
