import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getCuratedFeedByToken } from '#app/db/curated-feed-tokens.ts'
import { getDirectoryFeedByToken } from '#app/db/directory-feed-tokens.ts'
import { parseDirectoryPaths } from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { DirectoryFeed, Feed } from '#app/db/types.ts'

/**
 * Look up a feed by token without touching last_used_at.
 * We don't update last_used_at for media requests to avoid excessive DB writes.
 */
function getFeedByToken(
	token: string,
): { feed: Feed; type: 'directory' | 'curated' } | null {
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
 * Check if a feed is a DirectoryFeed.
 */
function isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPaths' in feed
}

/**
 * Parse the path parameter into root name and relative path.
 * Format: "rootName/relative/path/to/file.mp3"
 */
function parsePathParam(
	pathParam: string,
): { rootName: string; relativePath: string } | null {
	const firstSlash = pathParam.indexOf('/')
	if (firstSlash === -1) {
		// No slash means no relative path - invalid
		return null
	}
	const rootName = pathParam.slice(0, firstSlash)
	const relativePath = pathParam.slice(firstSlash + 1)
	if (!rootName || !relativePath) {
		return null
	}
	return { rootName, relativePath }
}

/**
 * Validate that a file path is allowed for the given feed.
 * For directory feeds, the file must be within one of the feed's directories.
 * For curated feeds, the file must be in the feed's item list.
 */
function isFileAllowed(
	feed: Feed,
	type: 'directory' | 'curated',
	rootName: string,
	relativePath: string,
): boolean {
	if (type === 'directory' && isDirectoryFeed(feed)) {
		// File must be within one of the feed's directories
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

	// For curated feeds, check if the file is in the item list
	const feedItems = getItemsForFeed(feed.id)
	return feedItems.some(
		(item) => item.mediaRoot === rootName && item.relativePath === relativePath,
	)
}

/**
 * Parse HTTP Range header.
 * Returns start and end byte positions, or null if no valid range.
 */
function parseRangeHeader(
	rangeHeader: string | null,
	fileSize: number,
): { start: number; end: number } | null {
	if (!rangeHeader) return null

	const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
	if (!match) return null

	const [, startStr, endStr] = match
	let start = startStr ? parseInt(startStr, 10) : 0
	let end = endStr ? parseInt(endStr, 10) : fileSize - 1

	// Validate range
	if (start > end || start >= fileSize) {
		return null
	}

	// Clamp end to file size
	end = Math.min(end, fileSize - 1)

	return { start, end }
}

export default {
	middleware: [],
	async action(context) {
		const { token, path: splatParam } = context.params
		if (!splatParam) {
			return new Response('File path required', { status: 400 })
		}

		// Decode the path parameter
		const decodedPath = decodeURIComponent(splatParam)

		// Parse root name and relative path from URL
		const parsed = parsePathParam(decodedPath)
		if (!parsed) {
			return new Response('Invalid path format', { status: 400 })
		}

		// Convert to absolute file path
		const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
		if (!filePath) {
			return new Response('Unknown media root', { status: 404 })
		}

		// Look up feed by token
		const result = getFeedByToken(token)
		if (!result) {
			return new Response('Not found', { status: 404 })
		}

		const { feed, type } = result

		// Validate file is allowed for this feed
		if (!isFileAllowed(feed, type, parsed.rootName, parsed.relativePath)) {
			return new Response('Not found', { status: 404 })
		}

		// Get the file
		const file = Bun.file(filePath)
		if (!(await file.exists())) {
			return new Response('File not found', { status: 404 })
		}

		const fileSize = file.size
		const contentType = file.type

		// Check for Range request
		const rangeHeader = context.request.headers.get('Range')
		const range = parseRangeHeader(rangeHeader, fileSize)

		if (range) {
			// Partial content response (206)
			const { start, end } = range
			const contentLength = end - start + 1

			// Slice the file for the requested range
			const slice = file.slice(start, end + 1)

			return new Response(slice, {
				status: 206,
				headers: {
					'Content-Type': contentType,
					'Content-Length': String(contentLength),
					'Content-Range': `bytes ${start}-${end}/${fileSize}`,
					'Accept-Ranges': 'bytes',
					'Cache-Control': 'public, max-age=31536000',
				},
			})
		}

		// Full file response (200)
		return new Response(file, {
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(fileSize),
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'public, max-age=31536000',
			},
		})
	},
} satisfies Action<
	typeof routes.media.method,
	typeof routes.media.pattern.source
>
