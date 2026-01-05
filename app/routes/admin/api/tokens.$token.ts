import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { revokeCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { revokeDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'

/**
 * DELETE /admin/api/tokens/:token
 * Revokes (soft deletes) a token.
 */
export default {
	middleware: [],
	action(context) {
		if (context.method !== 'DELETE') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		const { token } = context.params

		// Try directory feed token first
		const directoryRevoked = revokeDirectoryFeedToken(token)
		if (directoryRevoked) {
			return Response.json({ success: true })
		}

		// Try curated feed token
		const curatedRevoked = revokeCuratedFeedToken(token)
		if (curatedRevoked) {
			return Response.json({ success: true })
		}

		return Response.json({ error: 'Token not found' }, { status: 404 })
	},
} satisfies Action<
	typeof routes.adminApiToken.method,
	typeof routes.adminApiToken.pattern.source
>
