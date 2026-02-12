import nodePath from 'node:path'
import type { BuildAction } from 'remix/fetch-router'
import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { parseDirectoryPaths } from '#app/db/directory-feeds.ts'
import { createFeedAnalyticsEvent } from '#app/db/feed-analytics-events.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { Feed } from '#app/db/types.ts'
import { isDirectoryFeed } from '#app/db/types.ts'
import {
	getClientFingerprint,
	getClientName,
	getResponseBytesServed,
	isDownloadStartRequest,
	isTrackableMediaStatus,
} from '#app/helpers/analytics-request.ts'
import { decodePathParam } from '#app/helpers/decode-path-param.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import { serveFileWithRanges } from '#app/helpers/range-request.ts'

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

export default {
	middleware: [],
	async action(context) {
		const { token, path: splatParam } = context.params
		if (!splatParam) {
			return new Response('File path required', { status: 400 })
		}

		// Decode the path parameter
		const decodedPath = decodePathParam(splatParam)
		if (decodedPath === null) {
			return new Response('Invalid path encoding', { status: 400 })
		}

		// Parse root name and relative path from URL
		const parsed = parseMediaPathStrict(decodedPath)
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

		const response = serveFileWithRanges(
			file,
			context.request,
			'public, max-age=31536000',
		)

		if (isTrackableMediaStatus(response.status)) {
			try {
				createFeedAnalyticsEvent({
					eventType: 'media_request',
					feedId: feed.id,
					feedType: type,
					token,
					mediaRoot: parsed.rootName,
					relativePath: parsed.relativePath,
					isDownloadStart: isDownloadStartRequest(
						context.request,
						response.status,
					),
					bytesServed: getResponseBytesServed(response),
					statusCode: response.status,
					clientFingerprint: getClientFingerprint(context.request),
					clientName: getClientName(context.request),
				})
			} catch (error) {
				console.error('Failed to record media analytics event:', error)
			}
		}

		return response
	},
} satisfies BuildAction<typeof routes.media.method, typeof routes.media.pattern>
