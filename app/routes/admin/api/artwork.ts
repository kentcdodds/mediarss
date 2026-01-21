import type { Action } from 'remix/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'
import { parseMediaPath } from '#app/helpers/path-parsing.ts'
import { generatePlaceholderSvg } from '#app/helpers/placeholder-svg.ts'

/**
 * GET /admin/api/artwork/*path
 * Serves artwork for media files without requiring a feed token (admin-only).
 * URL format: /admin/api/artwork/<rootName>/<relativePath>
 * Example: /admin/api/artwork/audio/Harry%20Potter.m4b
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

		// Convert to absolute file path
		const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
		if (!filePath) {
			return new Response('Unknown media root', { status: 404 })
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

		// No embedded artwork - generate placeholder based on filename
		const filename = parsed.relativePath.split('/').pop() ?? parsed.rootName
		const svg = generatePlaceholderSvg(filename)
		return new Response(svg, {
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=86400',
			},
		})
	},
} satisfies Action<
	typeof routes.adminApiArtwork.method,
	typeof routes.adminApiArtwork.pattern.source
>
