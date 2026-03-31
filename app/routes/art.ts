import nodePath from 'node:path'
import { type BuildAction } from 'remix/fetch-router'
import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { parseDirectoryPaths } from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import { type Feed, isDirectoryFeed } from '#app/db/types.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'
import { decodePathParam } from '#app/helpers/decode-path-param.ts'
import { getFeedArtworkPath } from '#app/helpers/feed-artwork.ts'
import { resolveFeedArtwork } from '#app/helpers/feed-artwork-resolution.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { fileExists, getFileResponse } from '#app/helpers/node-file.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import {
	getPodcastArtPlaceholderBody,
	PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
} from '#app/helpers/podcast-art-placeholder.ts'

/**
 * Validate that a file path is allowed for the given feed.
 * For directory feeds, the file must be within one of the feed's directories.
 * For curated feeds, the file must be in the feed's item list.
 */
async function isFileAllowed(
	feed: Feed,
	type: 'directory' | 'curated',
	rootName: string,
	relativePath: string,
): Promise<boolean> {
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
	const feedItems = await getItemsForFeed(feed.id)
	return feedItems.some(
		(item) => item.mediaRoot === rootName && item.relativePath === relativePath,
	)
}

export default {
	middleware: [],
	async handler(context) {
		const { token, path: splatParam } = context.params

		// Look up feed by token
		const result = await getFeedByToken(token)
		if (!result) {
			return new Response('Not found', { status: 404 })
		}

		const { feed, type } = result

		// Special case: "/art/:token/feed" returns the feed's artwork
		if (splatParam === 'feed') {
			return resolveFeedArtwork(feed.id, feed, context.request)
		}

		// File-specific artwork
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

		// Validate file is allowed
		if (
			!(await isFileAllowed(feed, type, parsed.rootName, parsed.relativePath))
		) {
			return new Response('Not found', { status: 404 })
		}

		// Check file exists
		if (!(await fileExists(filePath))) {
			return new Response('File not found', { status: 404 })
		}

		// Try to extract embedded artwork
		const artwork = await extractArtwork(filePath)

		if (artwork) {
			return new Response(new Uint8Array(artwork.data), {
				headers: {
					'Content-Type': artwork.mimeType,
					'Cache-Control': 'public, max-age=31536000, immutable',
				},
			})
		}

		// No embedded artwork - fall back to feed artwork or placeholder
		// Priority 1: Check for uploaded feed artwork
		const uploadedFeedArtwork = await getFeedArtworkPath(feed.id)
		if (uploadedFeedArtwork) {
			const response = await getFileResponse(
				uploadedFeedArtwork.path,
				context.request,
				{
					cacheControl: 'public, max-age=86400',
					contentType: uploadedFeedArtwork.mimeType,
				},
			)
			if (response) {
				return response
			}
			return new Response('File not found', { status: 404 })
		}

		// Priority 2: Check for external imageUrl
		if (feed.imageUrl) {
			return new Response(null, {
				status: 302,
				headers: { Location: feed.imageUrl },
			})
		}

		// Priority 3: Raster placeholder (SVG is poorly supported in podcast apps)
		const png = getPodcastArtPlaceholderBody()
		return new Response(png, {
			headers: {
				'Content-Type': PODCAST_ART_PLACEHOLDER_CONTENT_TYPE,
				'Cache-Control': 'public, max-age=86400',
			},
		})
	},
} satisfies BuildAction<typeof routes.art.method, typeof routes.art.pattern>
