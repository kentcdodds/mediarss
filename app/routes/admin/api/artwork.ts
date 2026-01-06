import type { Action } from '@remix-run/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { extractArtwork } from '#app/helpers/artwork.ts'

/**
 * Generate a simple placeholder SVG for media without embedded artwork.
 */
function generatePlaceholderSvg(title: string): string {
	// Get first letter or emoji for the placeholder
	const firstChar = title.trim()[0]?.toUpperCase() ?? '?'

	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="#1a1a2e"/>
  <text x="300" y="340" font-family="system-ui, sans-serif" font-size="200" font-weight="bold" fill="#e94560" text-anchor="middle">${firstChar}</text>
</svg>`
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
		// No slash means no relative path - could be just the root
		return { rootName: pathParam, relativePath: '' }
	}
	const rootName = pathParam.slice(0, firstSlash)
	const relativePath = pathParam.slice(firstSlash + 1)
	if (!rootName) {
		return null
	}
	return { rootName, relativePath }
}

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
		const parsed = parsePathParam(decodedPath)
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
