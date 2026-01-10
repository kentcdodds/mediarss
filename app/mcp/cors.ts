/**
 * CORS utilities for MCP and OAuth endpoints.
 * MCP requires CORS support for browser-based clients.
 */

import type { RequestContext } from '@remix-run/fetch-router'

/**
 * Handler function type for Bun/Remix routes.
 */
type RouteHandler = (context: RequestContext) => Response | Promise<Response>

/**
 * Merge multiple headers objects into one (uses set so later headers override earlier).
 */
export function mergeHeaders(
	...headers: Array<HeadersInit | null | undefined>
): Headers {
	const merged = new Headers()
	for (const header of headers) {
		if (!header) continue
		new Headers(header).forEach((value, key) => {
			merged.set(key, value)
		})
	}
	return merged
}

/**
 * Wrap a route handler with CORS support.
 * Automatically handles OPTIONS preflight and adds CORS headers to all responses.
 *
 * @example
 * ```ts
 * export default {
 *   middleware: [],
 *   action: withCors({
 *     getCorsHeaders: (request) => MCP_CORS_HEADERS,
 *     handler: async (context) => {
 *       return Response.json({ ok: true })
 *     },
 *   }),
 * }
 * ```
 */
export function withCors({
	getCorsHeaders,
	handler,
}: {
	getCorsHeaders(
		request: Request,
	): Record<string, string> | Headers | null | undefined
	handler: RouteHandler
}): RouteHandler {
	return async (context) => {
		const corsHeaders = getCorsHeaders(context.request)
		if (!corsHeaders) {
			return handler(context)
		}

		// Handle CORS preflight requests
		if (context.request.method === 'OPTIONS') {
			const headers = mergeHeaders(corsHeaders, {
				'Access-Control-Max-Age': '86400',
			})

			return new Response(null, { status: 204, headers })
		}

		// Call the original handler
		const response = await handler(context)

		// Add CORS headers to ALL responses, including early returns
		const newHeaders = mergeHeaders(response.headers, corsHeaders)

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		})
	}
}

/**
 * CORS headers for MCP endpoints.
 * Note: DELETE is supported for session termination per MCP spec.
 */
export const MCP_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version',
	'Access-Control-Expose-Headers': 'mcp-session-id',
} as const

/**
 * CORS headers specifically for well-known endpoints.
 * These need to be more permissive for discovery.
 */
export const DISCOVERY_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'Accept, Content-Type, mcp-protocol-version',
} as const

/**
 * CORS headers for OAuth registration endpoint.
 * Allows POST with JSON content type.
 */
export const REGISTRATION_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept',
} as const

/**
 * CORS headers for OAuth token endpoint.
 * Allows POST with form-urlencoded content type.
 */
export const TOKEN_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept',
} as const
