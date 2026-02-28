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
export async function getFeedByToken(
	token: string,
): Promise<FeedLookupResult | null> {
	const directoryFeed = await getDirectoryFeedByToken(token)
	if (directoryFeed) {
		return { feed: directoryFeed, type: 'directory' }
	}

	const curatedFeed = await getCuratedFeedByToken(token)
	if (curatedFeed) {
		return { feed: curatedFeed, type: 'curated' }
	}

	return null
}

/**
 * Look up a feed by token and touch last_used_at.
 * Use this for RSS feed requests where we want to track usage.
 */
export async function getFeedByTokenAndTouch(
	token: string,
): Promise<FeedLookupResult | null> {
	const directoryFeed = await getDirectoryFeedByToken(token)
	if (directoryFeed) {
		await touchDirectoryFeedToken(token)
		return { feed: directoryFeed, type: 'directory' }
	}

	const curatedFeed = await getCuratedFeedByToken(token)
	if (curatedFeed) {
		await touchCuratedFeedToken(token)
		return { feed: curatedFeed, type: 'curated' }
	}

	return null
}
