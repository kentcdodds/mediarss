import type { Action } from 'remix/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

/**
 * GET /admin/api/directories
 * Returns all configured media root directories.
 */
export default {
	middleware: [],
	action() {
		const roots = getMediaRoots()

		return Response.json({
			roots,
		})
	},
} satisfies Action<
	typeof routes.adminApiDirectories.method,
	typeof routes.adminApiDirectories.pattern.source
>
