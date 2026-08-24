import { type Action } from 'remix/router'
import type routes from '#app/config/routes.ts'
import { createHealthResponse } from '#app/helpers/health.ts'

/**
 * Public GET /health — Docker, Cloudflare, and curl can reach this without
 * Access. Optional `?probe=cimd` fetches Kody's client metadata document.
 */
export default {
	middleware: [],
	async handler(context) {
		return createHealthResponse(context.url)
	},
} satisfies Action<typeof routes.health>
