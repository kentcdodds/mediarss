import type { Action } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { db } from '#app/db/index.ts'

/**
 * Health check endpoint for container orchestration and monitoring.
 * Returns 200 OK if the service is healthy, 503 if there are issues.
 */
export default {
	middleware: [],
	action() {
		try {
			// Verify database connectivity with a simple query
			db.query('SELECT 1').get()

			return Response.json({
				status: 'ok',
				timestamp: new Date().toISOString(),
			})
		} catch (error) {
			return Response.json(
				{
					status: 'error',
					timestamp: new Date().toISOString(),
					error: error instanceof Error ? error.message : 'Unknown error',
				},
				{ status: 503 },
			)
		}
	},
} satisfies Action<
	typeof routes.adminHealth.method,
	typeof routes.adminHealth.pattern.source
>
