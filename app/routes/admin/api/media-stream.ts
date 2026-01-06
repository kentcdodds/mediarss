import type { Action } from '@remix-run/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

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

/**
 * GET /admin/api/media-stream/*path
 * Streams media files for playback in the admin panel.
 * No feed token required (admin-only access).
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
					'Cache-Control': 'private, max-age=3600',
				},
			})
		}

		// Full file response (200)
		return new Response(file, {
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(fileSize),
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'private, max-age=3600',
			},
		})
	},
} satisfies Action<
	typeof routes.adminApiMediaStream.method,
	typeof routes.adminApiMediaStream.pattern.source
>
