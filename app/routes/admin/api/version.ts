import type { Action } from '@remix-run/fetch-router'
import { getGitHubRepo } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getVersionInfo } from '#app/helpers/version.ts'

/**
 * GET /admin/api/version
 * Returns version information including app version, commit info, and uptime.
 */
const adminApiVersionHandlers = {
	middleware: [],
	async action() {
		const versionInfo = await getVersionInfo()
		const githubRepo = getGitHubRepo()

		return Response.json({
			...versionInfo,
			githubRepo,
		})
	},
} satisfies Action<
	typeof routes.adminApiVersion.method,
	typeof routes.adminApiVersion.pattern.source
>

export default adminApiVersionHandlers
