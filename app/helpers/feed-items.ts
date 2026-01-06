import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed } from '#app/db/types.ts'
import { filterMediaFiles } from '#app/helpers/filter.ts'
import {
	getFileMetadata,
	type MediaFile,
	scanDirectoryWithMetadata,
} from '#app/helpers/media.ts'
import { sortMediaFiles } from '#app/helpers/sort.ts'

/**
 * Get media items for a directory feed.
 * Scans the directory, applies filters, and sorts.
 */
export async function getDirectoryFeedItems(
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
export async function getCuratedFeedItems(
	feed: CuratedFeed,
): Promise<Array<MediaFile>> {
	// Get feed items from database (already ordered by position)
	const feedItems = getItemsForFeed(feed.id)

	// Get metadata for each item
	const items: Array<MediaFile> = []
	for (const feedItem of feedItems) {
		const metadata = await getFileMetadata(feedItem.filePath)
		if (metadata) {
			items.push(metadata)
		}
	}

	// For curated feeds with sortFields === 'position', preserve database order
	// (items are already ordered by position from getItemsForFeed)
	if (feed.sortFields === 'position') {
		return items
	}

	// Sort items by specified fields
	const sortString = `${feed.sortOrder}:${feed.sortFields}`
	return sortMediaFiles(items, sortString)
}
