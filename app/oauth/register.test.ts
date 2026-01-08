// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import { afterAll, expect, test } from 'bun:test'
import type { RequestContext } from '@remix-run/fetch-router'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { resetRateLimiters } from '#app/helpers/rate-limiter.ts'
import { deleteClient, getClient } from '#app/oauth/clients.ts'
import { computeS256Challenge, generateCodeVerifier } from '#app/oauth/pkce.ts'

// Ensure migrations are run
migrate(db)

// Track created test client IDs for cleanup
const testClientIds: string[] = []

/**
 * Creates a test server with DCR and OAuth routes.
 */
async function createDcrTestServer() {
	resetRateLimiters()

	// Import handlers directly instead of full router to avoid MCP transport issues
	const oauthRegisterHandlers = await import('#app/routes/oauth/register.ts')
	const oauthServerMetadataHandlers = await import(
		'#app/routes/oauth/server-metadata.ts'
	)
	const oauthTokenHandlers = await import('#app/routes/oauth/token.ts')
	const adminAuthorizeHandlers = await import('#app/routes/admin/authorize.tsx')

	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url)

			const context = {
				request,
				method: request.method,
				url,
				params: {},
			} as RequestContext

			// Route to the appropriate handler
			if (url.pathname === '/oauth/register') {
				return oauthRegisterHandlers.default.action(context)
			}
			if (url.pathname === '/.well-known/oauth-authorization-server') {
				return oauthServerMetadataHandlers.default.action(context)
			}
			if (url.pathname === '/oauth/token') {
				return oauthTokenHandlers.default.action(context)
			}
			if (url.pathname === '/admin/authorize') {
				return adminAuthorizeHandlers.default.action(context)
			}

			return new Response('Not Found', { status: 404 })
		},
	})

	const baseUrl = `http://localhost:${server.port}`

	return {
		server,
		baseUrl,
		[Symbol.dispose]: () => {
			server.stop()
			resetRateLimiters()
		},
	}
}

afterAll(() => {
	// Clean up test clients
	for (const clientId of testClientIds) {
		deleteClient(clientId)
	}
	resetRateLimiters()
})

test('server metadata includes registration_endpoint for DCR', async () => {
	using ctx = await createDcrTestServer()

	const response = await fetch(
		`${ctx.baseUrl}/.well-known/oauth-authorization-server`,
	)
	expect(response.status).toBe(200)

	const metadata = (await response.json()) as {
		registration_endpoint: string
	}
	expect(metadata.registration_endpoint).toBe(`${ctx.baseUrl}/oauth/register`)
})

test('DCR endpoint creates clients with various configurations', async () => {
	using ctx = await createDcrTestServer()

	// Create client with name and single redirect URI
	const basicResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
			client_name: 'DCR Test Client',
		}),
	})

	expect(basicResponse.status).toBe(201)
	const basicClientData = (await basicResponse.json()) as {
		client_id: string
		client_name: string
		redirect_uris: string[]
		token_endpoint_auth_method: string
		grant_types: string[]
		response_types: string[]
		client_id_issued_at: number
	}

	testClientIds.push(basicClientData.client_id)

	expect(basicClientData.client_id).toBeTruthy()
	expect(basicClientData.client_name).toBe('DCR Test Client')
	expect(basicClientData.redirect_uris).toEqual([
		'http://localhost:9999/callback',
	])
	expect(basicClientData.token_endpoint_auth_method).toBe('none')
	expect(basicClientData.grant_types).toContain('authorization_code')
	expect(basicClientData.response_types).toContain('code')
	expect(basicClientData.client_id_issued_at).toBeGreaterThan(0)

	// Verify client was persisted to database
	const dbClient = getClient(basicClientData.client_id)
	expect(dbClient).not.toBeNull()
	expect(dbClient!.name).toBe('DCR Test Client')

	// Create client with multiple redirect URIs
	const multiUriResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: [
				'http://localhost:3000/callback',
				'http://localhost:8080/callback',
			],
			client_name: 'Multi-URI Client',
		}),
	})

	expect(multiUriResponse.status).toBe(201)
	const multiUriClientData = (await multiUriResponse.json()) as {
		client_id: string
		redirect_uris: string[]
	}

	testClientIds.push(multiUriClientData.client_id)
	expect(multiUriClientData.redirect_uris).toEqual([
		'http://localhost:3000/callback',
		'http://localhost:8080/callback',
	])

	// Create client without name (should generate default)
	const noNameResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
		}),
	})

	expect(noNameResponse.status).toBe(201)
	const noNameClientData = (await noNameResponse.json()) as {
		client_id: string
		client_name: string
	}

	testClientIds.push(noNameClientData.client_id)
	expect(noNameClientData.client_name).toMatch(/^Dynamic Client \d+$/)
})

test('DCR endpoint rejects invalid registration requests', async () => {
	using ctx = await createDcrTestServer()

	// Missing redirect_uris
	const missingUrisResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_name: 'Bad Client',
		}),
	})
	expect(missingUrisResponse.status).toBe(400)
	expect(((await missingUrisResponse.json()) as { error: string }).error).toBe(
		'invalid_redirect_uri',
	)

	// Empty redirect_uris
	const emptyUrisResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: [],
		}),
	})
	expect(emptyUrisResponse.status).toBe(400)
	const emptyUrisError = (await emptyUrisResponse.json()) as {
		error: string
		error_description: string
	}
	expect(emptyUrisError.error).toBe('invalid_redirect_uri')
	expect(emptyUrisError.error_description).toContain('not be empty')

	// Invalid redirect URI format
	const invalidUriResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['not-a-valid-url'],
		}),
	})
	expect(invalidUriResponse.status).toBe(400)
	expect(((await invalidUriResponse.json()) as { error: string }).error).toBe(
		'invalid_redirect_uri',
	)

	// Non-JSON content type
	const textResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain' },
		body: 'not json',
	})
	expect(textResponse.status).toBe(400)
	expect(((await textResponse.json()) as { error: string }).error).toBe(
		'invalid_client_metadata',
	)

	// Invalid JSON body
	const badJsonResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: 'not valid json',
	})
	expect(badJsonResponse.status).toBe(400)
	expect(((await badJsonResponse.json()) as { error: string }).error).toBe(
		'invalid_client_metadata',
	)

	// Unsupported token_endpoint_auth_method
	const unsupportedAuthResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
			token_endpoint_auth_method: 'client_secret_basic',
		}),
	})
	expect(unsupportedAuthResponse.status).toBe(400)
	const unsupportedAuthError = (await unsupportedAuthResponse.json()) as {
		error: string
		error_description: string
	}
	expect(unsupportedAuthError.error).toBe('invalid_client_metadata')
	expect(unsupportedAuthError.error_description).toContain('none')

	// grant_types without authorization_code
	const noAuthCodeGrantResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
			grant_types: ['client_credentials'],
		}),
	})
	expect(noAuthCodeGrantResponse.status).toBe(400)
	const noAuthCodeGrantError = (await noAuthCodeGrantResponse.json()) as {
		error: string
		error_description: string
	}
	expect(noAuthCodeGrantError.error).toBe('invalid_client_metadata')
	expect(noAuthCodeGrantError.error_description).toContain('authorization_code')
})

test('DCR endpoint supports CORS', async () => {
	using ctx = await createDcrTestServer()

	// OPTIONS request returns CORS headers
	const optionsResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'OPTIONS',
	})
	expect(optionsResponse.status).toBe(204)
	expect(optionsResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')
	expect(optionsResponse.headers.get('Access-Control-Allow-Methods')).toContain(
		'POST',
	)

	// POST response includes CORS headers
	const postResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
		}),
	})
	expect(postResponse.status).toBe(201)
	expect(postResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')

	const clientData = (await postResponse.json()) as { client_id: string }
	testClientIds.push(clientData.client_id)
})

test('full OAuth flow with DCR-registered client', async () => {
	using ctx = await createDcrTestServer()

	// Step 1: Register client via DCR
	const registerResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
			client_name: 'Full Flow Test Client',
		}),
	})

	expect(registerResponse.status).toBe(201)
	const clientData = (await registerResponse.json()) as {
		client_id: string
		redirect_uris: string[]
	}
	testClientIds.push(clientData.client_id)

	// Step 2: Start authorization flow with PKCE
	const verifier = generateCodeVerifier()
	const challenge = await computeS256Challenge(verifier)

	const authorizeParams = new URLSearchParams({
		response_type: 'code',
		client_id: clientData.client_id,
		redirect_uri: clientData.redirect_uris[0]!,
		scope: 'read write',
		state: 'test-state',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	})

	// Step 3: Submit authorization (simulates user clicking "Authorize")
	const authorizeResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	expect(authorizeResponse.status).toBe(302)
	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!
	expect(code).toBeTruthy()
	expect(redirectUrl.searchParams.get('state')).toBe('test-state')

	// Step 4: Exchange code for token
	const tokenResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: clientData.redirect_uris[0]!,
			client_id: clientData.client_id,
			code_verifier: verifier,
		}).toString(),
	})

	expect(tokenResponse.status).toBe(200)

	const tokenData = (await tokenResponse.json()) as {
		access_token: string
		token_type: string
		expires_in: number
		scope: string
	}

	expect(tokenData.access_token).toBeTruthy()
	expect(tokenData.token_type).toBe('Bearer')
	expect(tokenData.expires_in).toBeGreaterThan(0)
	expect(tokenData.scope).toBe('read write')
})
