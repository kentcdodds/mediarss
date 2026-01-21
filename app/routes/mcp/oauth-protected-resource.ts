/**
 * OAuth Protected Resource Metadata endpoint.
 * Per RFC 9728 and MCP Authorization spec.
 *
 * This endpoint provides discovery information for MCP clients,
 * telling them where to authenticate.
 */

import type { Action, RequestContext } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { MCP_SCOPES } from '#app/mcp/auth.ts'
import { DISCOVERY_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'

/**
 * Protected Resource Metadata per RFC 9728.
 */
interface ProtectedResourceMetadata {
	/** The protected resource identifier (URL of the MCP endpoint) */
	resource: string
	/** URLs of authorization servers that can issue tokens for this resource */
	authorization_servers: string[]
	/** Scopes supported by this resource */
	scopes_supported: readonly string[]
}

function handleGet(context: RequestContext): Response {
	const origin = getOrigin(context.request, context.url)

	const metadata: ProtectedResourceMetadata = {
		resource: `${origin}/mcp`,
		authorization_servers: [origin],
		scopes_supported: MCP_SCOPES,
	}

	return Response.json(metadata, {
		headers: {
			'Cache-Control': 'public, max-age=3600',
		},
	})
}

export default {
	middleware: [],
	action: withCors({
		getCorsHeaders: () => DISCOVERY_CORS_HEADERS,
		handler: (context: RequestContext) => {
			if (context.method !== 'GET' && context.method !== 'HEAD') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'GET, HEAD, OPTIONS' },
				})
			}

			return handleGet(context)
		},
	}),
} satisfies Action<
	typeof routes.mcpProtectedResource.method,
	typeof routes.mcpProtectedResource.pattern.source
>
