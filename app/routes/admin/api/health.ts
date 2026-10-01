import { type Action } from 'remix/router'
import { type routes } from '#app/routes.ts'
import { createHealthResponse } from '#app/helpers/health.ts'

/**
 * GET /admin/health
 * Same payload as public /health so existing Docker smoke tests keep working.
 */
export default {
	middleware: [],
	async handler(context) {
		return createHealthResponse(context.url)
	},
} satisfies Action<typeof routes.adminHealth>
