/**
 * Feed access control utilities.
 *
 * Provides functions to check if a file is accessible within a feed's scope.
 */

import nodePath from 'node:path'
import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import { parseDirectoryPaths } from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { Feed } from '#app/db/types.ts'
import { isDirectoryFeed } from '#app/db/types.ts'

/**
 * Validate that a file path is allowed for the given feed.
 *
 * For directory feeds, the file must be within one of the feed's directories.
 * For curated feeds, the file must be in the feed's item list.
 *
 * This function provides path traversal protection by resolving paths
 * and checking that the file is within the allowed directories.
 */
export function isFileAllowed(
	feed: Feed,
	type: 'directory' | 'curated',
	rootName: string,
	relativePath: string,
): boolean {
	if (type === 'directory' && isDirectoryFeed(feed)) {
		const paths = parseDirectoryPaths(feed)
		const filePath = toAbsolutePath(rootName, relativePath)
		if (!filePath) return false

		for (const mediaPath of paths) {
			const { mediaRoot, relativePath: dirRelativePath } =
				parseMediaPath(mediaPath)
			const dirPath = toAbsolutePath(mediaRoot, dirRelativePath)
			if (!dirPath) continue

			const resolvedDir = nodePath.resolve(dirPath)
			const resolvedFile = nodePath.resolve(filePath)
			if (resolvedFile.startsWith(resolvedDir + nodePath.sep)) {
				return true
			}
		}
		return false
	}

	const feedItems = getItemsForFeed(feed.id)
	return feedItems.some(
		(item) => item.mediaRoot === rootName && item.relativePath === relativePath,
	)
}

/**
 * Encode a relative path for use in URLs, encoding each segment individually.
 * This preserves slashes as path separators while encoding special characters
 * within each segment.
 */
export function encodeRelativePath(relativePath: string): string {
	return relativePath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')
}
