import type { BuildAction, RequestContext } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { TOKEN_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import {
	clientSupportsGrantType,
	consumeAuthorizationCode,
	generateAccessToken,
	getValidAuthorizationCode,
	resolveClient,
	verifyCodeChallenge,
} from '#app/oauth/index.ts'

interface TokenRequest {
	grant_type: string
	code: string
	redirect_uri: string
	client_id: string
	code_verifier: string
}

interface TokenErrorResponse {
	error: string
	error_description?: string
}

interface TokenSuccessResponse {
	access_token: string
	token_type: string
	expires_in: number
	scope?: string
}

function errorResponse(
	error: string,
	description: string,
	status = 400,
): Response {
	const body: TokenErrorResponse = {
		error,
		error_description: description,
	}
	return Response.json(body, {
		status,
		headers: {
			'Cache-Control': 'no-store',
			Pragma: 'no-cache',
		},
	})
}

async function parseTokenRequest(
	request: Request,
): Promise<TokenRequest | null> {
	const contentType = request.headers.get('content-type')

	// Token endpoint requires application/x-www-form-urlencoded
	if (!contentType?.includes('application/x-www-form-urlencoded')) {
		return null
	}

	try {
		const text = await request.text()
		const params = new URLSearchParams(text)

		return {
			grant_type: params.get('grant_type') ?? '',
			code: params.get('code') ?? '',
			redirect_uri: params.get('redirect_uri') ?? '',
			client_id: params.get('client_id') ?? '',
			code_verifier: params.get('code_verifier') ?? '',
		}
	} catch {
		return null
	}
}

/**
 * POST /oauth/token - Token endpoint
 * Exchanges an authorization code for an access token.
 * Requires PKCE code_verifier.
 *
 * Supports both static client IDs and URL-based Client ID Metadata Documents
 * per MCP 2025-11-25 spec.
 */
async function handlePost(context: RequestContext): Promise<Response> {
	const tokenRequest = await parseTokenRequest(context.request)

	if (!tokenRequest) {
		return errorResponse(
			'invalid_request',
			'Request must use application/x-www-form-urlencoded content type.',
		)
	}

	// Validate grant_type
	if (tokenRequest.grant_type !== 'authorization_code') {
		return errorResponse(
			'unsupported_grant_type',
			'Only authorization_code grant type is supported.',
		)
	}

	// Validate client
	if (!tokenRequest.client_id) {
		return errorResponse('invalid_request', 'client_id is required.')
	}

	// Resolve client (supports both static clients and URL-based metadata documents)
	const client = await resolveClient(tokenRequest.client_id)
	if (!client) {
		return errorResponse('invalid_client', 'Unknown client.', 401)
	}

	// Validate client supports authorization_code grant type
	if (!clientSupportsGrantType(client, 'authorization_code')) {
		return errorResponse(
			'unauthorized_client',
			'This client is not authorized to use the authorization_code grant type.',
		)
	}

	// Validate code
	if (!tokenRequest.code) {
		return errorResponse('invalid_request', 'code is required.')
	}

	// Get the authorization code WITHOUT consuming it first
	// This prevents an attacker from invalidating a legitimate code by submitting
	// it with wrong parameters (client_id, redirect_uri, or PKCE verifier)
	const authCode = getValidAuthorizationCode(tokenRequest.code)
	if (!authCode) {
		return errorResponse(
			'invalid_grant',
			'Authorization code is invalid, expired, or has already been used.',
		)
	}

	// Validate that the code belongs to this client
	if (authCode.clientId !== tokenRequest.client_id) {
		return errorResponse(
			'invalid_grant',
			'Authorization code was not issued to this client.',
		)
	}

	// Validate redirect_uri matches the original
	if (tokenRequest.redirect_uri !== authCode.redirectUri) {
		return errorResponse(
			'invalid_grant',
			'redirect_uri does not match the original authorization request.',
		)
	}

	// PKCE verification (required)
	if (!tokenRequest.code_verifier) {
		return errorResponse('invalid_request', 'code_verifier is required.')
	}

	const pkceValid = await verifyCodeChallenge(
		tokenRequest.code_verifier,
		authCode.codeChallenge,
		authCode.codeChallengeMethod,
	)

	if (!pkceValid) {
		return errorResponse('invalid_grant', 'PKCE verification failed.')
	}

	// All validations passed - now atomically consume the authorization code
	// This uses an atomic UPDATE to prevent race conditions
	const consumedCode = consumeAuthorizationCode(tokenRequest.code)
	if (!consumedCode) {
		// Code was consumed by another request between validation and consumption
		return errorResponse(
			'invalid_grant',
			'Authorization code is invalid, expired, or has already been used.',
		)
	}

	// Validate Host header to prevent issuer injection attacks
	const { isAllowedHost } = await import('#app/helpers/origin.ts')
	if (!isAllowedHost(context.url.host)) {
		return errorResponse('invalid_request', 'Invalid host header.', 400)
	}

	// Generate access token
	// Determine issuer from request URL (respects X-Forwarded-Proto for reverse proxies)
	const issuer = getOrigin(context.request, context.url)

	const { token, expiresIn } = await generateAccessToken({
		issuer,
		scope: authCode.scope,
	})

	const response: TokenSuccessResponse = {
		access_token: token,
		token_type: 'Bearer',
		expires_in: expiresIn,
	}

	if (authCode.scope) {
		response.scope = authCode.scope
	}

	return Response.json(response, {
		headers: {
			'Cache-Control': 'no-store',
			Pragma: 'no-cache',
		},
	})
}

export default {
	middleware: [],
	action: withCors({
		getCorsHeaders: () => TOKEN_CORS_HEADERS,
		handler: async (context: RequestContext) => {
			if (context.method !== 'POST') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'POST, OPTIONS' },
				})
			}
			return handlePost(context)
		},
	}),
} satisfies BuildAction<
	typeof routes.oauthToken.method,
	typeof routes.oauthToken.pattern
>
