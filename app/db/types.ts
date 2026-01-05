export type SortOrder = 'asc' | 'desc'

export type DirectoryFeed = {
	id: string
	name: string
	description: string
	token: string
	directoryPath: string
	sortBy: string
	sortOrder: SortOrder
	createdAt: number
	updatedAt: number
}

export type CuratedFeed = {
	id: string
	name: string
	description: string
	token: string
	sortBy: string
	sortOrder: SortOrder
	createdAt: number
	updatedAt: number
}

export type FeedItem = {
	id: string
	feedId: string
	filePath: string
	position: number | null
	addedAt: number
}

export type Feed = DirectoryFeed | CuratedFeed

/**
 * Type guard to check if a feed is a DirectoryFeed
 */
export function isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPath' in feed
}

/**
 * Type guard to check if a feed is a CuratedFeed
 */
export function isCuratedFeed(feed: Feed): feed is CuratedFeed {
	return !('directoryPath' in feed)
}
