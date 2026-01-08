// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

describe('Dynamic Client Registration (DCR)', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string

	beforeAll(async () => {
		resetRateLimiters()

		// Import handlers directly instead of full router to avoid MCP transport issues
		const oauthRegisterHandlers = await import('#app/routes/oauth/register.ts')
		const oauthServerMetadataHandlers = await import(
			'#app/routes/oauth/server-metadata.ts'
		)
		const oauthTokenHandlers = await import('#app/routes/oauth/token.ts')
		const adminAuthorizeHandlers = await import(
			'#app/routes/admin/authorize.tsx'
		)

		server = Bun.serve({
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

		baseUrl = `http://localhost:${server.port}`
	})

	afterAll(() => {
		if (server) {
			server.stop()
		}
		// Clean up test clients
		for (const clientId of testClientIds) {
			deleteClient(clientId)
		}
		resetRateLimiters()
	})

	test('server metadata includes registration_endpoint', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		expect(response.status).toBe(200)

		const metadata = (await response.json()) as {
			registration_endpoint: string
		}
		expect(metadata.registration_endpoint).toBe(`${baseUrl}/oauth/register`)
	})

	test('POST /oauth/register creates a new client', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['http://localhost:9999/callback'],
				client_name: 'DCR Test Client',
			}),
		})

		expect(response.status).toBe(201)

		const clientData = (await response.json()) as {
			client_id: string
			client_name: string
			redirect_uris: string[]
			token_endpoint_auth_method: string
			grant_types: string[]
			response_types: string[]
			client_id_issued_at: number
		}

		testClientIds.push(clientData.client_id)

		expect(clientData.client_id).toBeTruthy()
		expect(clientData.client_name).toBe('DCR Test Client')
		expect(clientData.redirect_uris).toEqual(['http://localhost:9999/callback'])
		expect(clientData.token_endpoint_auth_method).toBe('none')
		expect(clientData.grant_types).toContain('authorization_code')
		expect(clientData.response_types).toContain('code')
		expect(clientData.client_id_issued_at).toBeGreaterThan(0)

		// Verify client was persisted to database
		const dbClient = getClient(clientData.client_id)
		expect(dbClient).not.toBeNull()
		expect(dbClient!.name).toBe('DCR Test Client')
	})

	test('POST /oauth/register with multiple redirect URIs', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: [
					'http://localhost:3000/callback',
					'http://localhost:8080/callback',
				],
				client_name: 'Multi-URI Client',
			}),
		})

		expect(response.status).toBe(201)

		const clientData = (await response.json()) as {
			client_id: string
			redirect_uris: string[]
		}

		testClientIds.push(clientData.client_id)

		expect(clientData.redirect_uris).toEqual([
			'http://localhost:3000/callback',
			'http://localhost:8080/callback',
		])
	})

	test('POST /oauth/register generates default client_name', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['http://localhost:9999/callback'],
				// No client_name provided
			}),
		})

		expect(response.status).toBe(201)

		const clientData = (await response.json()) as {
			client_id: string
			client_name: string
		}

		testClientIds.push(clientData.client_id)

		expect(clientData.client_name).toMatch(/^Dynamic Client \d+$/)
	})

	test('POST /oauth/register rejects missing redirect_uris', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_name: 'Bad Client',
			}),
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
			error_description: string
		}
		expect(error.error).toBe('invalid_redirect_uri')
	})

	test('POST /oauth/register rejects empty redirect_uris', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: [],
			}),
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
			error_description: string
		}
		expect(error.error).toBe('invalid_redirect_uri')
		expect(error.error_description).toContain('not be empty')
	})

	test('POST /oauth/register rejects invalid redirect URI format', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['not-a-valid-url'],
			}),
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
			error_description: string
		}
		expect(error.error).toBe('invalid_redirect_uri')
	})

	test('POST /oauth/register rejects non-JSON content type', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
			},
			body: 'not json',
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
		}
		expect(error.error).toBe('invalid_client_metadata')
	})

	test('POST /oauth/register rejects invalid JSON body', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: 'not valid json',
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
		}
		expect(error.error).toBe('invalid_client_metadata')
	})

	test('POST /oauth/register rejects unsupported token_endpoint_auth_method', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['http://localhost:9999/callback'],
				token_endpoint_auth_method: 'client_secret_basic',
			}),
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
			error_description: string
		}
		expect(error.error).toBe('invalid_client_metadata')
		expect(error.error_description).toContain('none')
	})

	test('POST /oauth/register rejects grant_types without authorization_code', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['http://localhost:9999/callback'],
				grant_types: ['client_credentials'],
			}),
		})

		expect(response.status).toBe(400)

		const error = (await response.json()) as {
			error: string
			error_description: string
		}
		expect(error.error).toBe('invalid_client_metadata')
		expect(error.error_description).toContain('authorization_code')
	})

	test('OPTIONS /oauth/register returns CORS headers', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'OPTIONS',
		})

		expect(response.status).toBe(204)
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
			'POST',
		)
	})

	test('POST /oauth/register response includes CORS headers', async () => {
		const response = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				redirect_uris: ['http://localhost:9999/callback'],
			}),
		})

		expect(response.status).toBe(201)
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')

		const clientData = (await response.json()) as { client_id: string }
		testClientIds.push(clientData.client_id)
	})

	test('Full OAuth flow with DCR client', async () => {
		// Step 1: Register client via DCR
		const registerResponse = await fetch(`${baseUrl}/oauth/register`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
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
			`${baseUrl}/admin/authorize?${authorizeParams}`,
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
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
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
})
