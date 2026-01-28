/**
 * MCP-UI Widget HTTP endpoint.
 *
 * Serves the media player widget HTML directly via HTTP.
 * This allows the widget to be accessed without going through the MCP protocol,
 * which is useful for:
 * - Direct browser access for testing
 * - ChatGPT's MCP-UI integration which may need to fetch resources via HTTP
 * - Caching/CDN scenarios
 *
 * Uses token-based authentication to ensure only authorized users can access media.
 */

import type { BuildAction } from 'remix/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { isFileAllowed } from '#app/helpers/feed-access.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import { generateMediaWidgetHtml } from '#app/mcp/widgets.ts'

/**
 * GET /mcp/widget/:token/*path
 * Returns an HTML page with the media player widget.
 *
 * URL format: /mcp/widget/<token>/<rootName>/<relativePath>
 * Example: /mcp/widget/abc123/audio/Harry%20Potter.m4b
 */
export default {
	middleware: [],
	async action(context) {
		const { token, path: splatParam } = context.params

		if (!splatParam) {
			return new Response('Path required', { status: 400 })
		}

		// Look up feed by token
		const result = getFeedByToken(token)
		if (!result) {
			return new Response('Not found', { status: 404 })
		}

		const { feed, type } = result

		// Decode the path parameter with error handling for malformed encoding
		let decodedPath: string
		try {
			decodedPath = decodeURIComponent(splatParam)
		} catch {
			return new Response('Invalid URL encoding', { status: 400 })
		}

		// Parse root name and relative path from URL
		const parsed = parseMediaPathStrict(decodedPath)
		if (!parsed) {
			return new Response('Invalid path format', { status: 400 })
		}

		const { rootName, relativePath } = parsed

		// Convert to absolute file path
		const filePath = toAbsolutePath(rootName, relativePath)
		if (!filePath) {
			return new Response('Unknown media root', { status: 404 })
		}

		// Validate file is allowed for this feed
		if (!isFileAllowed(feed, type, rootName, relativePath)) {
			return new Response('Not found', { status: 404 })
		}

		// Get file metadata
		const metadata = await getFileMetadata(filePath)
		if (!metadata) {
			return new Response('File not found or not a media file', { status: 404 })
		}

		// Determine base URL from the request (respects X-Forwarded-Proto for reverse proxies)
		const baseUrl = getOrigin(context.request, context.url)

		// Generate the HTML widget shell
		// Note: Media data is passed via MCP-UI initial-render-data protocol when accessed
		// through ChatGPT. Direct browser access will show a loading state.
		const html = generateMediaWidgetHtml({ baseUrl })

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'private, max-age=300', // 5 minute cache
			},
		})
	},
} satisfies BuildAction<
	typeof routes.mcpWidget.method,
	typeof routes.mcpWidget.pattern
>
