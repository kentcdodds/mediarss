import { type Action, type RequestContext } from 'remix/router'
import type routes from '#app/config/routes.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { TOKEN_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import {
	clientSupportsGrantType,
	consumeAuthorizationCode,
	consumeRefreshToken,
	createRefreshToken,
	generateAccessToken,
	getRefreshToken,
	getValidAuthorizationCode,
	resolveClient,
	rotateRefreshToken,
	verifyCodeChallenge,
} from '#app/oauth/index.ts'

interface TokenRequest {
	grant_type: string
	code: string
	redirect_uri: string
	client_id: string
	code_verifier: string
	refresh_token: string
	scope: string
}

interface TokenErrorResponse {
	error: string
	error_description?: string
}

interface TokenSuccessResponse {
	access_token: string
	token_type: string
	expires_in: number
	refresh_token: string
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

function jsonTokenResponse(body: TokenSuccessResponse): Response {
	return Response.json(body, {
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
			refresh_token: params.get('refresh_token') ?? '',
			scope: params.get('scope') ?? '',
		}
	} catch {
		return null
	}
}

function validateAllowedHost(context: RequestContext): Response | null {
	const allowedHosts = process.env.ALLOWED_HOSTS?.split(',').map((h) =>
		h.trim(),
	)
	const requestHost = context.url.host

	if (allowedHosts && allowedHosts.length > 0) {
		if (!allowedHosts.includes(requestHost)) {
			return errorResponse('invalid_request', 'Invalid host header.', 400)
		}
	}

	return null
}

function requestedScopeIsAllowed(
	requestedScope: string,
	grantedScope: string,
): boolean {
	if (!requestedScope) {
		return true
	}

	const granted = new Set(grantedScope.split(' ').filter(Boolean))
	return requestedScope
		.split(' ')
		.filter(Boolean)
		.every((scope) => granted.has(scope))
}

async function issueTokenPair(params: {
	issuer: string
	clientId: string
	scope: string
	refreshToken: string
}): Promise<TokenSuccessResponse> {
	const { token, expiresIn } = await generateAccessToken({
		issuer: params.issuer,
		scope: params.scope,
		clientId: params.clientId,
	})

	const response: TokenSuccessResponse = {
		access_token: token,
		token_type: 'Bearer',
		expires_in: expiresIn,
		refresh_token: params.refreshToken,
	}

	if (params.scope) {
		response.scope = params.scope
	}

	return response
}

async function handleAuthorizationCode(
	context: RequestContext,
	tokenRequest: TokenRequest,
): Promise<Response> {
	if (!tokenRequest.client_id) {
		return errorResponse('invalid_request', 'client_id is required.')
	}

	const client = await resolveClient(tokenRequest.client_id)
	if (!client) {
		return errorResponse('invalid_client', 'Unknown client.', 401)
	}

	if (!clientSupportsGrantType(client, 'authorization_code')) {
		return errorResponse(
			'unauthorized_client',
			'This client is not authorized to use the authorization_code grant type.',
		)
	}

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

	if (authCode.clientId !== tokenRequest.client_id) {
		return errorResponse(
			'invalid_grant',
			'Authorization code was not issued to this client.',
		)
	}

	if (tokenRequest.redirect_uri !== authCode.redirectUri) {
		return errorResponse(
			'invalid_grant',
			'redirect_uri does not match the original authorization request.',
		)
	}

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

	const consumedCode = consumeAuthorizationCode(tokenRequest.code)
	if (!consumedCode) {
		return errorResponse(
			'invalid_grant',
			'Authorization code is invalid, expired, or has already been used.',
		)
	}

	const hostError = validateAllowedHost(context)
	if (hostError) {
		return hostError
	}

	const issuer = getOrigin(context.request, context.url)
	const refresh = createRefreshToken({
		clientId: authCode.clientId,
		scope: authCode.scope,
	})

	return jsonTokenResponse(
		await issueTokenPair({
			issuer,
			clientId: authCode.clientId,
			scope: authCode.scope,
			refreshToken: refresh.token,
		}),
	)
}

async function handleRefreshToken(
	context: RequestContext,
	tokenRequest: TokenRequest,
): Promise<Response> {
	if (!tokenRequest.client_id) {
		return errorResponse('invalid_request', 'client_id is required.')
	}

	if (!tokenRequest.refresh_token) {
		return errorResponse('invalid_request', 'refresh_token is required.')
	}

	const client = await resolveClient(tokenRequest.client_id)
	if (!client) {
		return errorResponse('invalid_client', 'Unknown client.', 401)
	}

	if (!clientSupportsGrantType(client, 'refresh_token')) {
		return errorResponse(
			'unauthorized_client',
			'This client is not authorized to use the refresh_token grant type.',
		)
	}

	const existing = getRefreshToken(tokenRequest.refresh_token)
	const now = Math.floor(Date.now() / 1000)
	if (!existing || existing.expiresAt < now) {
		return errorResponse(
			'invalid_grant',
			'Refresh token is invalid, expired, or has already been used.',
		)
	}
	if (existing.usedAt !== null) {
		consumeRefreshToken(tokenRequest.refresh_token)
		return errorResponse(
			'invalid_grant',
			'Refresh token is invalid, expired, or has already been used.',
		)
	}

	if (existing.clientId !== tokenRequest.client_id) {
		return errorResponse(
			'invalid_grant',
			'Refresh token was not issued to this client.',
		)
	}

	if (!requestedScopeIsAllowed(tokenRequest.scope, existing.scope)) {
		return errorResponse(
			'invalid_scope',
			'Requested scope exceeds the scope originally granted.',
		)
	}

	const hostError = validateAllowedHost(context)
	if (hostError) {
		return hostError
	}

	const consumed = consumeRefreshToken(tokenRequest.refresh_token)
	if (!consumed) {
		return errorResponse(
			'invalid_grant',
			'Refresh token is invalid, expired, or has already been used.',
		)
	}

	const scope = tokenRequest.scope || consumed.scope
	const rotated = rotateRefreshToken({
		...consumed,
		scope,
	})
	const issuer = getOrigin(context.request, context.url)

	return jsonTokenResponse(
		await issueTokenPair({
			issuer,
			clientId: consumed.clientId,
			scope,
			refreshToken: rotated.token,
		}),
	)
}

/**
 * POST /oauth/token - Token endpoint
 * Exchanges an authorization code or refresh token for access credentials.
 * Authorization-code grants require PKCE.
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

	switch (tokenRequest.grant_type) {
		case 'authorization_code':
			return handleAuthorizationCode(context, tokenRequest)
		case 'refresh_token':
			return handleRefreshToken(context, tokenRequest)
		default:
			return errorResponse(
				'unsupported_grant_type',
				'Only authorization_code and refresh_token grant types are supported.',
			)
	}
}

export default {
	middleware: [],
	handler: withCors({
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
} satisfies Action<typeof routes.oauthToken>
