import { type Action } from 'remix/router'
import { toAbsolutePath } from '#app/config/env.ts'
import { type routes } from '#app/routes.ts'
import { parseMediaPath } from '#app/helpers/path-parsing.ts'
import { serveFileWithRanges } from '#app/helpers/range-request.ts'

/**
 * GET /admin/api/media-stream/*path
 * Streams media files for playback in the admin panel.
 * No feed token required (admin-only access).
 */
export default {
	middleware: [],
	async handler(context) {
		const { path: splatParam } = context.params

		if (!splatParam) {
			return new Response('Path required', { status: 400 })
		}

		// Parse root name and relative path from URL
		const parsed = parseMediaPath(splatParam)
		if (!parsed) {
			return new Response('Invalid path format', { status: 400 })
		}

		// Convert to absolute file path
		const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
		if (!filePath) {
			return new Response('Unknown media root', { status: 404 })
		}

		return serveFileWithRanges(
			filePath,
			context.request,
			'private, max-age=3600',
		)
	},
} satisfies Action<typeof routes.adminApiMediaStream>
