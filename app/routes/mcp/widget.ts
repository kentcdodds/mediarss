/**
 * MCP-UI Widget HTTP endpoint.
 *
 * Serves the media player widget HTML directly via HTTP.
 * This allows the widget to be accessed without going through the MCP protocol,
 * which is useful for:
 * - Direct browser access for testing
 * - ChatGPT's MCP-UI integration which may need to fetch resources via HTTP
 * - Caching/CDN scenarios
 */

import type { Action } from '@remix-run/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { parseMediaPath } from '#app/helpers/path-parsing.ts'
import {
	generateMediaWidgetHtml,
	type MediaWidgetData,
} from '#app/mcp/widgets.ts'

/**
 * GET /mcp/widget/*path
 * Returns an HTML page with the media player widget.
 *
 * URL format: /mcp/widget/<rootName>/<relativePath>
 * Example: /mcp/widget/audio/Harry%20Potter.m4b
 */
export default {
	middleware: [],
	async action(context) {
		const { path: splatParam } = context.params

		if (!splatParam) {
			return new Response('Path required', { status: 400 })
		}

		// Decode the path parameter
		const decodedPath = decodeURIComponent(splatParam)

		// Parse root name and relative path from URL
		const parsed = parseMediaPath(decodedPath)
		if (!parsed) {
			return new Response('Invalid path format', { status: 400 })
		}

		const { rootName, relativePath } = parsed

		// Convert to absolute file path
		const filePath = toAbsolutePath(rootName, relativePath)
		if (!filePath) {
			return new Response('Unknown media root', { status: 404 })
		}

		// Get file metadata
		const metadata = await getFileMetadata(filePath)
		if (!metadata) {
			return new Response('File not found or not a media file', { status: 404 })
		}

		// Determine base URL from the request
		const baseUrl = `${context.url.protocol}//${context.url.host}`

		// Build the widget data
		const mediaData: MediaWidgetData = {
			title: metadata.title,
			author: metadata.author,
			duration: metadata.duration,
			sizeBytes: metadata.sizeBytes,
			mimeType: metadata.mimeType,
			publicationDate: metadata.publicationDate?.toISOString() ?? null,
			description: metadata.description,
			narrators: metadata.narrators,
			genres: metadata.genres,
			artworkUrl: `/admin/api/artwork/${encodeURIComponent(rootName)}/${encodeURIComponent(relativePath)}`,
			streamUrl: `/admin/api/media-stream/${encodeURIComponent(rootName)}/${encodeURIComponent(relativePath)}`,
		}

		// Generate the HTML widget
		const html = generateMediaWidgetHtml({
			baseUrl,
			media: mediaData,
		})

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'private, max-age=300', // 5 minute cache
			},
		})
	},
} satisfies Action<
	typeof routes.mcpWidget.method,
	typeof routes.mcpWidget.pattern.source
>
