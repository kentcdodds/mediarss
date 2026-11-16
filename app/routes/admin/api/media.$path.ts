import { type Action } from 'remix/router'
import { toAbsolutePath } from '#app/config/env.ts'
import { type routes } from '#app/routes.ts'
import { buildMediaDetailResponse } from '#app/helpers/media-metadata-edit.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { parseMediaPath } from '#app/helpers/path-parsing.ts'

/**
 * GET /admin/api/media/*path
 * Returns detailed metadata for a single media file.
 */
export default {
	middleware: [],
	async handler(context) {
		const { path: splatParam } = context.params

		if (!splatParam) {
			return Response.json({ error: 'Path required' }, { status: 400 })
		}

		const parsed = parseMediaPath(splatParam)
		if (!parsed) {
			return Response.json({ error: 'Invalid path format' }, { status: 400 })
		}

		const { rootName, relativePath } = parsed
		const filePath = toAbsolutePath(rootName, relativePath)
		if (!filePath) {
			return Response.json({ error: 'Unknown media root' }, { status: 404 })
		}

		const metadata = await getFileMetadata(filePath)
		if (!metadata) {
			return Response.json(
				{ error: 'File not found or not a media file' },
				{ status: 404 },
			)
		}

		return Response.json(
			await buildMediaDetailResponse(metadata, rootName, relativePath),
		)
	},
} satisfies Action<typeof routes.adminApiMediaDetail>
