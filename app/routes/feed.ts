import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import {
	getCuratedFeedByToken,
	touchCuratedFeedToken,
} from '#app/db/curated-feed-tokens.ts'
import {
	getDirectoryFeedByToken,
	touchDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import type { CuratedFeed, DirectoryFeed, Feed } from '#app/db/types.ts'
import {
	getCuratedFeedItems,
	getDirectoryFeedItems,
} from '#app/helpers/feed-items.ts'
import type { MediaFile } from '#app/helpers/media.ts'
import { generateRssFeed } from '#app/helpers/rss.ts'

/**
 * Get the base URL from the request.
 */
function getBaseUrl(request: Request): string {
	const url = new URL(request.url)
	return `${url.protocol}//${url.host}`
}

/**
 * Look up a feed by token.
 * Tries directory feeds first, then curated feeds.
 * Returns the feed and its type.
 */
function getFeedByToken(
	token: string,
): { feed: Feed; type: 'directory' | 'curated' } | null {
	// Try directory feed first
	const directoryFeed = getDirectoryFeedByToken(token)
	if (directoryFeed) {
		touchDirectoryFeedToken(token)
		return { feed: directoryFeed, type: 'directory' }
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedByToken(token)
	if (curatedFeed) {
		touchCuratedFeedToken(token)
		return { feed: curatedFeed, type: 'curated' }
	}

	return null
}

/**
 * Check if a feed is a DirectoryFeed.
 */
function isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPaths' in feed
}

export default {
	middleware: [],
	async action(context) {
		const { token } = context.params

		// Look up feed by token
		const result = getFeedByToken(token)
		if (!result) {
			return new Response('Feed not found', { status: 404 })
		}

		const { feed, type } = result
		const baseUrl = getBaseUrl(context.request)
		const feedUrl = `${baseUrl}/feed/${token}`

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
		})

		return new Response(rssXml, {
			headers: {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				'Cache-Control': 'no-cache',
			},
		})
	},
} satisfies Action<typeof routes.feed.method, typeof routes.feed.pattern.source>
