import type { Action } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import type { CuratedFeed } from '#app/db/types.ts'
import { isDirectoryFeed } from '#app/db/types.ts'
import {
	getCuratedFeedItems,
	getDirectoryFeedItems,
} from '#app/helpers/feed-items.ts'
import { getFeedByTokenAndTouch } from '#app/helpers/feed-lookup.ts'
import type { MediaFile } from '#app/helpers/media.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { generateRssFeed } from '#app/helpers/rss.ts'

/**
 * Get the base URL from the request.
 */
function getBaseUrl(request: Request): string {
	const url = new URL(request.url)
	return getOrigin(request, url)
}

export default {
	middleware: [],
	async action(context) {
		const { token } = context.params

		// Look up feed by token
		const result = getFeedByTokenAndTouch(token)
		if (!result) {
			return new Response('Feed not found', { status: 404 })
		}

		const { feed, type } = result
		const baseUrl = getBaseUrl(context.request)
		const feedUrl = `${baseUrl}/feed/${token}`
		const adminUrl = `${baseUrl}/admin/feeds/${feed.id}`

		// Get items based on feed type
		let items: Array<MediaFile>
		if (type === 'directory' && isDirectoryFeed(feed)) {
			items = await getDirectoryFeedItems(feed)
		} else {
			items = await getCuratedFeedItems(feed as CuratedFeed)
		}

		// Generate RSS XML
		const rssXml = generateRssFeed({
			feed,
			items,
			baseUrl,
			token,
			feedUrl,
			adminUrl,
			sortFields: feed.sortFields,
		})

		return new Response(rssXml, {
			headers: {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				'Cache-Control': 'no-cache',
			},
		})
	},
} satisfies Action<typeof routes.feed.method, typeof routes.feed.pattern.source>
