import {
	getCuratedFeedByToken,
	touchCuratedFeedToken,
} from '#app/db/curated-feed-tokens.ts'
import {
	getDirectoryFeedByToken,
	touchDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import type { Feed } from '#app/db/types.ts'

export type FeedLookupResult = {
	feed: Feed
	type: 'directory' | 'curated'
}

/**
 * Look up a feed by token without touching last_used_at.
 * Use this for media/artwork requests where we don't want excessive DB writes.
 */
export function getFeedByToken(token: string): FeedLookupResult | null {
	const directoryFeed = getDirectoryFeedByToken(token)
	if (directoryFeed) {
		return { feed: directoryFeed, type: 'directory' }
	}

	const curatedFeed = getCuratedFeedByToken(token)
	if (curatedFeed) {
		return { feed: curatedFeed, type: 'curated' }
	}

	return null
}

/**
 * Look up a feed by token and touch last_used_at.
 * Use this for RSS feed requests where we want to track usage.
 */
export function getFeedByTokenAndTouch(token: string): FeedLookupResult | null {
	const directoryFeed = getDirectoryFeedByToken(token)
	if (directoryFeed) {
		touchDirectoryFeedToken(token)
		return { feed: directoryFeed, type: 'directory' }
	}

	const curatedFeed = getCuratedFeedByToken(token)
	if (curatedFeed) {
		touchCuratedFeedToken(token)
		return { feed: curatedFeed, type: 'curated' }
	}

	return null
}
