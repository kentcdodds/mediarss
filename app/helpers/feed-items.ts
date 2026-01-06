import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import { parseDirectoryPaths } from '#app/db/directory-feeds.ts'
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
 * Scans all configured directories, applies filters, and sorts.
 */
export async function getDirectoryFeedItems(
	feed: DirectoryFeed,
): Promise<Array<MediaFile>> {
	// Parse the directory paths from JSON
	const paths = parseDirectoryPaths(feed)

	// Scan all directories and merge results
	const allItems: Array<MediaFile> = []
	for (const mediaPath of paths) {
		const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
		const absolutePath = toAbsolutePath(mediaRoot, relativePath)
		if (absolutePath) {
			const items = await scanDirectoryWithMetadata(absolutePath)
			allItems.push(...items)
		}
	}

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
		// Convert mediaRoot + relativePath to absolute path
		const absolutePath = toAbsolutePath(
			feedItem.mediaRoot,
			feedItem.relativePath,
		)
		if (!absolutePath) continue

		const metadata = await getFileMetadata(absolutePath)
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
