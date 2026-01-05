import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getCuratedFeedByToken } from '#app/db/curated-feed-tokens.ts'
import { getDirectoryFeedByToken } from '#app/db/directory-feed-tokens.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { DirectoryFeed, Feed } from '#app/db/types.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'

/**
 * Look up a feed by token without touching last_used_at.
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
	return 'directoryPath' in feed
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
 */
function isFileAllowed(
	feed: Feed,
	type: 'directory' | 'curated',
	filePath: string,
): boolean {
	if (type === 'directory' && isDirectoryFeed(feed)) {
		const feedDir = nodePath.resolve(feed.directoryPath)
		const resolvedPath = nodePath.resolve(filePath)
		return resolvedPath.startsWith(feedDir + nodePath.sep)
	}

	const feedItems = getItemsForFeed(feed.id)
	return feedItems.some((item) => item.filePath === filePath)
}

/**
 * Generate a simple placeholder SVG for feeds/items without artwork.
 */
function generatePlaceholderSvg(title: string): string {
	// Get first letter or emoji for the placeholder
	const firstChar = title.trim()[0]?.toUpperCase() ?? '?'

	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="#1a1a2e"/>
  <text x="300" y="340" font-family="system-ui, sans-serif" font-size="200" font-weight="bold" fill="#e94560" text-anchor="middle">${firstChar}</text>
</svg>`
}

export default {
	middleware: [],
	async action(context) {
		const { token, path: splatParam } = context.params

		// Look up feed by token
		const result = getFeedByToken(token)
		if (!result) {
			return new Response('Not found', { status: 404 })
		}

		const { feed, type } = result

		// Special case: "/art/:token/feed" returns the feed's artwork
		if (splatParam === 'feed') {
			// If feed has an imageUrl, redirect to it
			if (feed.imageUrl) {
				return new Response(null, {
					status: 302,
					headers: { Location: feed.imageUrl },
				})
			}

			// Generate placeholder
			const svg = generatePlaceholderSvg(feed.name)
			return new Response(svg, {
				headers: {
					'Content-Type': 'image/svg+xml',
					'Cache-Control': 'public, max-age=86400',
				},
			})
		}

		// File-specific artwork
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

		// Validate file is allowed
		if (!isFileAllowed(feed, type, filePath)) {
			return new Response('Not found', { status: 404 })
		}

		// Check file exists
		const file = Bun.file(filePath)
		if (!(await file.exists())) {
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
		if (feed.imageUrl) {
			return new Response(null, {
				status: 302,
				headers: { Location: feed.imageUrl },
			})
		}

		// Generate placeholder based on filename
		const filename = nodePath.basename(filePath)
		const svg = generatePlaceholderSvg(filename)
		return new Response(svg, {
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=86400',
			},
		})
	},
} satisfies Action<typeof routes.art.method, typeof routes.art.pattern.source>
