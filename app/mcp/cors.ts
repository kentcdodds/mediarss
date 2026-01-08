/**
 * CORS utilities for MCP endpoints.
 * MCP requires CORS support for browser-based clients.
 */

/**
 * CORS headers for MCP endpoints.
 */
export const MCP_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers':
		'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version',
	'Access-Control-Expose-Headers': 'mcp-session-id',
	'Access-Control-Max-Age': '86400',
} as const

/**
 * Handle CORS preflight request.
 * @returns Response for OPTIONS request
 */
export function handleCorsPrelight(): Response {
	return new Response(null, {
		status: 204,
		headers: MCP_CORS_HEADERS,
	})
}

/**
 * Add CORS headers to an existing response.
 * @param response - The response to add headers to
 * @returns New response with CORS headers
 */
export function addCorsHeaders(response: Response): Response {
	const headers = new Headers(response.headers)

	headers.set(
		'Access-Control-Allow-Origin',
		MCP_CORS_HEADERS['Access-Control-Allow-Origin'],
	)
	headers.set(
		'Access-Control-Expose-Headers',
		MCP_CORS_HEADERS['Access-Control-Expose-Headers'],
	)

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

/**
 * CORS headers specifically for well-known endpoints.
 * These need to be more permissive for discovery.
 */
export const DISCOVERY_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'mcp-protocol-version',
} as const

/**
 * Handle CORS preflight for discovery endpoints.
 * @returns Response for OPTIONS request
 */
export function handleDiscoveryCorsPrelight(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...DISCOVERY_CORS_HEADERS,
			'Access-Control-Max-Age': '86400',
		},
	})
}
