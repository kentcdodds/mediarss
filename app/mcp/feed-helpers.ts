import { getCuratedFeedById, listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
	listDirectoryFeeds,
} from '#app/db/directory-feeds.ts'
import type { CuratedFeed, DirectoryFeed } from '#app/db/types.ts'

export type FeedWithType =
	| (DirectoryFeed & { type: 'directory' })
	| (CuratedFeed & { type: 'curated' })

/**
 * Get all feeds (both directory and curated).
 */
export async function getAllFeeds(): Promise<Array<FeedWithType>> {
	const directoryFeeds = (await listDirectoryFeeds()).map((feed) => ({
		...feed,
		type: 'directory' as const,
	}))
	const curatedFeeds = (await listCuratedFeeds()).map((feed) => ({
		...feed,
		type: 'curated' as const,
	}))
	return [...directoryFeeds, ...curatedFeeds].sort(
		(a, b) => b.createdAt - a.createdAt,
	)
}

/**
 * Get a feed by ID (checks both directory and curated).
 */
export async function getFeedById(
	id: string,
): Promise<FeedWithType | undefined> {
	const directoryFeed = await getDirectoryFeedById(id)
	if (directoryFeed) return { ...directoryFeed, type: 'directory' }

	const curatedFeed = await getCuratedFeedById(id)
	if (curatedFeed) return { ...curatedFeed, type: 'curated' }

	return undefined
}
