import { type BuildAction } from 'remix/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

/**
 * GET /admin/api/directories
 * Returns all configured media root directories.
 */
export default {
	middleware: [],
	handler() {
		const roots = getMediaRoots()

		return Response.json({
			roots,
		})
	},
} satisfies BuildAction<
	typeof routes.adminApiDirectories.method,
	typeof routes.adminApiDirectories.pattern
>
