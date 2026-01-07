import type { Action, RequestContext } from '@remix-run/fetch-router'
import { html } from '@remix-run/html-template'
import { Layout } from '#app/components/layout.tsx'
import type routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'
import {
	createAuthorizationCode,
	getClient,
	isValidCodeChallenge,
	isValidRedirectUri,
} from '#app/oauth/index.ts'

interface AuthorizeParams {
	response_type: string
	client_id: string
	redirect_uri: string
	scope: string
	state: string
	code_challenge: string
	code_challenge_method: string
}

function parseAuthorizeParams(url: URL): AuthorizeParams {
	return {
		response_type: url.searchParams.get('response_type') ?? '',
		client_id: url.searchParams.get('client_id') ?? '',
		redirect_uri: url.searchParams.get('redirect_uri') ?? '',
		scope: url.searchParams.get('scope') ?? '',
		state: url.searchParams.get('state') ?? '',
		code_challenge: url.searchParams.get('code_challenge') ?? '',
		code_challenge_method: url.searchParams.get('code_challenge_method') ?? '',
	}
}

function renderError(title: string, message: string): Response {
	return render(
		Layout({
			title: 'Authorization Error',
			entryScript: false,
			children: html`
				<main style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui, sans-serif;">
					<h1 style="color: #dc2626;">${title}</h1>
					<p style="color: #666; margin: 20px 0;">${message}</p>
					<a href="/admin" style="color: #3b82f6; text-decoration: none;">← Back to Admin</a>
				</main>
			`,
		}),
		{ status: 400 },
	)
}

function renderAuthorizePage(
	params: AuthorizeParams,
	clientName: string,
): Response {
	// Build form action URL with all params
	const formAction = `/admin/authorize?${new URLSearchParams({
		response_type: params.response_type,
		client_id: params.client_id,
		redirect_uri: params.redirect_uri,
		scope: params.scope,
		state: params.state,
		code_challenge: params.code_challenge,
		code_challenge_method: params.code_challenge_method,
	}).toString()}`

	return render(
		Layout({
			title: 'Authorize Application',
			entryScript: false,
			children: html`
				<main style="max-width: 500px; margin: 80px auto; padding: 32px; font-family: system-ui, sans-serif; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1);">
					<div style="text-align: center; margin-bottom: 32px;">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
							<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
						</svg>
					</div>

					<h1 style="text-align: center; margin: 0 0 8px 0; font-size: 24px; color: #111;">Authorize Application</h1>
					<p style="text-align: center; color: #666; margin: 0 0 32px 0;">
						<strong>${clientName}</strong> wants to access your account
					</p>

					${
						params.scope
							? html`
								<div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
									<p style="margin: 0 0 8px 0; font-weight: 500; color: #374151;">Requested permissions:</p>
									<p style="margin: 0; color: #6b7280; font-size: 14px;">${params.scope}</p>
								</div>
							`
							: ''
					}

					<form method="POST" action="${formAction}">
						<button type="submit"
							style="width: 100%; padding: 14px 24px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 500; cursor: pointer; transition: background 0.2s;"
							onmouseover="this.style.background='#2563eb'"
							onmouseout="this.style.background='#3b82f6'">
							Authorize
						</button>
					</form>

					<p style="text-align: center; margin-top: 16px; font-size: 13px; color: #9ca3af;">
						You will be redirected to<br>
						<code style="font-size: 12px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${params.redirect_uri}</code>
					</p>
				</main>
			`,
		}),
	)
}

/**
 * GET /admin/authorize - Show authorization page
 * This endpoint is protected by Cloudflare Access.
 * If the user can reach this page, they are already authenticated.
 */
function handleGet(context: RequestContext): Response {
	const params = parseAuthorizeParams(context.url)

	// Validate response_type
	if (params.response_type !== 'code') {
		return renderError(
			'Invalid Request',
			'Only "code" response_type is supported.',
		)
	}

	// Validate client
	const client = getClient(params.client_id)
	if (!client) {
		return renderError(
			'Invalid Client',
			'The specified client_id is not registered.',
		)
	}

	// Validate redirect_uri
	if (
		!params.redirect_uri ||
		!isValidRedirectUri(client, params.redirect_uri)
	) {
		return renderError(
			'Invalid Redirect URI',
			'The redirect_uri is not registered for this client.',
		)
	}

	// Validate PKCE (required)
	if (!params.code_challenge) {
		return renderError(
			'PKCE Required',
			'The code_challenge parameter is required.',
		)
	}

	if (params.code_challenge_method !== 'S256') {
		return renderError(
			'Invalid PKCE Method',
			'Only S256 code_challenge_method is supported.',
		)
	}

	if (!isValidCodeChallenge(params.code_challenge)) {
		return renderError(
			'Invalid Code Challenge',
			'The code_challenge is malformed.',
		)
	}

	return renderAuthorizePage(params, client.name)
}

/**
 * POST /admin/authorize - Process authorization and redirect with code
 * This endpoint is protected by Cloudflare Access.
 */
function handlePost(context: RequestContext): Response {
	const params = parseAuthorizeParams(context.url)

	// Re-validate everything (defense in depth)
	if (params.response_type !== 'code') {
		return renderError(
			'Invalid Request',
			'Only "code" response_type is supported.',
		)
	}

	const client = getClient(params.client_id)
	if (!client) {
		return renderError(
			'Invalid Client',
			'The specified client_id is not registered.',
		)
	}

	if (
		!params.redirect_uri ||
		!isValidRedirectUri(client, params.redirect_uri)
	) {
		return renderError(
			'Invalid Redirect URI',
			'The redirect_uri is not registered for this client.',
		)
	}

	if (!params.code_challenge || params.code_challenge_method !== 'S256') {
		return renderError('PKCE Required', 'Valid PKCE parameters are required.')
	}

	if (!isValidCodeChallenge(params.code_challenge)) {
		return renderError(
			'Invalid Code Challenge',
			'The code_challenge is malformed.',
		)
	}

	// Create authorization code
	const authCode = createAuthorizationCode({
		clientId: client.id,
		redirectUri: params.redirect_uri,
		scope: params.scope,
		codeChallenge: params.code_challenge,
		codeChallengeMethod: params.code_challenge_method,
	})

	// Build redirect URL with authorization code
	const redirectUrl = new URL(params.redirect_uri)
	redirectUrl.searchParams.set('code', authCode.code)
	if (params.state) {
		redirectUrl.searchParams.set('state', params.state)
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: redirectUrl.toString(),
		},
	})
}

export default {
	middleware: [],
	action(context: RequestContext) {
		if (context.method === 'POST') {
			return handlePost(context)
		}
		return handleGet(context)
	},
} satisfies Action<
	typeof routes.adminAuthorize.method,
	typeof routes.adminAuthorize.pattern.source
>
