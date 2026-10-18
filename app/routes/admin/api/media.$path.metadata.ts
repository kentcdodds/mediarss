import { type Action } from 'remix/router'
import { type routes } from '#app/routes.ts'
import { applyMediaMetadataUpdate } from '#app/helpers/media-metadata-edit.ts'
import { parseMediaPath } from '#app/helpers/path-parsing.ts'

/**
 * PUT /admin/api/media/*path/metadata
 * Updates metadata for a single media file using FFmpeg.
 * Returns the updated MediaDetailResponse.
 *
 * Validation, path containment, the FFmpeg write, and cache invalidation are
 * shared with the MCP `update_media_metadata` tool via
 * `#app/helpers/media-metadata-edit.ts`.
 */
export default {
	middleware: [],
	async handler(context) {
		// Only allow PUT requests
		if (context.request.method !== 'PUT') {
			return Response.json(
				{ error: 'Method not allowed' },
				{ status: 405, headers: { Allow: 'PUT' } },
			)
		}

		const { path: splatParam } = context.params

		if (!splatParam) {
			return Response.json({ error: 'Path required' }, { status: 400 })
		}

		// Remove trailing /metadata from the path
		const pathWithoutMetadata = splatParam.replace(/\/metadata$/, '')

		// Parse root name and relative path from URL
		const parsed = parseMediaPath(pathWithoutMetadata)
		if (!parsed) {
			return Response.json({ error: 'Invalid path format' }, { status: 400 })
		}

		// Parse request body
		let body: unknown
		try {
			body = await context.request.json()
		} catch {
			return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
		}

		const result = await applyMediaMetadataUpdate(
			parsed.rootName,
			parsed.relativePath,
			body,
		)
		if (!result.ok) {
			return Response.json(
				result.details
					? { error: result.error, details: result.details }
					: { error: result.error },
				{ status: result.status },
			)
		}

		return Response.json(result.response)
	},
} satisfies Action<typeof routes.adminApiMediaMetadata>
