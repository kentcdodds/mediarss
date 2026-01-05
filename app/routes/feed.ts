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
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed, Feed } from '#app/db/types.ts'
import { filterMediaFiles } from '#app/helpers/filter.ts'
import {
	getFileMetadata,
	type MediaFile,
	scanDirectoryWithMetadata,
} from '#app/helpers/media.ts'
import { generateRssFeed } from '#app/helpers/rss.ts'
import { sortMediaFiles } from '#app/helpers/sort.ts'

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
 * Get media items for a directory feed.
 * Scans the directory, applies filters, and sorts.
 */
async function getDirectoryFeedItems(
	feed: DirectoryFeed,
): Promise<Array<MediaFile>> {
	// Scan the directory for media files
	const allItems = await scanDirectoryWithMetadata(feed.directoryPath)

	// Apply filters
	const filteredItems = filterMediaFiles(allItems, {
		filterIn: feed.filterIn,
		filterOut: feed.filterOut,
	})

	// Sort items
	const sortString = `${feed.sortOrder}:${feed.sortFields}`
	return sortMediaFiles(filteredItems, sortString)
}

/**
 * Get media items for a curated feed.
 * Fetches items from the database and gets their metadata.
 */
async function getCuratedFeedItems(
	feed: CuratedFeed,
): Promise<Array<MediaFile>> {
	// Get feed items from database
	const feedItems = getItemsForFeed(feed.id)

	// Get metadata for each item
	const items: Array<MediaFile> = []
	for (const feedItem of feedItems) {
		const metadata = await getFileMetadata(feedItem.filePath)
		if (metadata) {
			items.push(metadata)
		}
	}

	// Sort items
	const sortString = `${feed.sortOrder}:${feed.sortFields}`
	return sortMediaFiles(items, sortString)
}

/**
 * Check if a feed is a DirectoryFeed.
 */
function isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPath' in feed
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
