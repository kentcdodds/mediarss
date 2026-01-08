/**
 * MCP Authentication utilities.
 * Handles token verification and authorization for MCP requests.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import {
	type AccessTokenPayload,
	verifyAccessToken,
} from '#app/oauth/tokens.ts'

// Re-export the SDK's AuthInfo type for use elsewhere
export type { AuthInfo }

/**
 * Extended auth info with our custom fields stored in extra.
 */
export interface AuthInfoExtra {
	/** Subject (user identifier) from the token */
	sub: string
	/** Full token payload */
	payload: AccessTokenPayload
}

/**
 * Helper to get the extra data from AuthInfo.
 */
export function getAuthExtra(authInfo: AuthInfo): AuthInfoExtra {
	return authInfo.extra as unknown as AuthInfoExtra
}

/**
 * Supported MCP scopes.
 * - mcp:read: Read-only access to feeds and media
 * - mcp:write: Create/modify feeds and media assignments
 */
export const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * Resolve authentication information from an Authorization header.
 * @param authHeader - The Authorization header value (e.g., "Bearer <token>")
 * @param issuer - The expected issuer URL for token verification
 * @returns AuthInfo if the token is valid, null otherwise
 */
export async function resolveAuthInfo(
	authHeader: string | null,
	issuer: string,
): Promise<AuthInfo | null> {
	const token = authHeader?.replace(/^Bearer\s+/i, '')
	if (!token) return null

	const payload = await verifyAccessToken(token, issuer)
	if (!payload) return null

	return {
		token,
		clientId: payload.client_id ?? 'unknown',
		scopes: payload.scope ? payload.scope.split(' ') : [],
		extra: {
			sub: payload.sub,
			payload,
		} satisfies AuthInfoExtra,
	}
}

/**
 * Check if the auth info has the required scope(s).
 * @param authInfo - The authentication information
 * @param requiredScopes - Scope(s) that are required
 * @returns true if all required scopes are present
 */
export function hasScope(
	authInfo: AuthInfo,
	...requiredScopes: McpScope[]
): boolean {
	return requiredScopes.every((scope) => authInfo.scopes.includes(scope))
}

/**
 * Generate a 401 Unauthorized response with proper WWW-Authenticate header.
 * Per MCP spec, this includes the resource_metadata URL for discovery.
 * @param request - The original request
 * @returns Response with 401 status and WWW-Authenticate header
 */
export function handleUnauthorized(request: Request): Response {
	const hasAuthHeader = request.headers.has('authorization')
	const url = new URL('/.well-known/oauth-protected-resource/mcp', request.url)

	const wwwAuthenticateParts = [
		`Bearer realm="MediaServer"`,
		hasAuthHeader ? `error="invalid_token"` : null,
		hasAuthHeader
			? `error_description="The access token is invalid or expired"`
			: null,
		`resource_metadata=${url.toString()}`,
	].filter(Boolean)

	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': wwwAuthenticateParts.join(', '),
		},
	})
}

/**
 * Generate a 403 Forbidden response for insufficient scope.
 * @param requiredScopes - The scopes that were required
 * @returns Response with 403 status
 */
export function handleInsufficientScope(requiredScopes: McpScope[]): Response {
	return new Response('Forbidden', {
		status: 403,
		headers: {
			'WWW-Authenticate': [
				`Bearer realm="MediaServer"`,
				`error="insufficient_scope"`,
				`error_description="Required scope(s): ${requiredScopes.join(' ')}"`,
				`scope="${requiredScopes.join(' ')}"`,
			].join(', '),
		},
	})
}
