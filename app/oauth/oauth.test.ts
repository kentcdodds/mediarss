// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import {
	clearKeyCache,
	computeS256Challenge,
	consumeAuthorizationCode,
	createAuthorizationCode,
	createClient,
	deleteClient,
	generateCodeVerifier,
	getAudience,
	getClient,
	getSubject,
	isValidCodeChallenge,
	isValidCodeVerifier,
	listClients,
	verifyCodeChallenge,
} from './index.ts'

// Ensure migrations are run
migrate(db)

// Helper to generate unique test client names
const uniqueId = () =>
	`test-${Date.now()}-${Math.random().toString(36).slice(2)}`

// Track created test resources for cleanup
const testClientIds: string[] = []

function createTestClient(
	name: string = 'Test Client',
	redirectUris: string[] = ['http://localhost:9999/callback'],
) {
	const client = createClient(name, redirectUris)
	testClientIds.push(client.id)
	return client
}

// Clean up test data after all tests
afterAll(() => {
	for (const clientId of testClientIds) {
		deleteClient(clientId)
	}
	// Clean up any orphaned test authorization codes
	db.run(sql`DELETE FROM authorization_codes WHERE client_id LIKE 'test-%';`)
})

describe('PKCE utilities', () => {
	test('generateCodeVerifier produces valid verifiers', () => {
		const verifier = generateCodeVerifier()
		expect(isValidCodeVerifier(verifier)).toBe(true)
		expect(verifier.length).toBeGreaterThanOrEqual(43)
	})

	test('computeS256Challenge produces correct challenge', async () => {
		// Known test vector from RFC 7636
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
		const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

		const challenge = await computeS256Challenge(verifier)
		expect(challenge).toBe(expectedChallenge)
	})

	test('verifyCodeChallenge returns true for valid pair', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const result = await verifyCodeChallenge(verifier, challenge, 'S256')
		expect(result).toBe(true)
	})

	test('verifyCodeChallenge returns false for invalid verifier', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)
		const wrongVerifier = generateCodeVerifier()

		const result = await verifyCodeChallenge(wrongVerifier, challenge, 'S256')
		expect(result).toBe(false)
	})

	test('verifyCodeChallenge rejects non-S256 methods', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const result = await verifyCodeChallenge(verifier, challenge, 'plain')
		expect(result).toBe(false)
	})

	test('isValidCodeVerifier rejects short verifiers', () => {
		expect(isValidCodeVerifier('short')).toBe(false)
	})

	test('isValidCodeVerifier rejects invalid characters', () => {
		const invalidVerifier = 'a'.repeat(43) + '!'
		expect(isValidCodeVerifier(invalidVerifier)).toBe(false)
	})

	test('isValidCodeChallenge validates length', () => {
		expect(isValidCodeChallenge('short')).toBe(false)
		expect(
			isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'),
		).toBe(true)
	})
})

describe('OAuth clients', () => {
	test('createClient creates a client', () => {
		const client = createTestClient('Test Client ' + uniqueId())
		expect(client.name).toContain('Test Client')
		expect(client.redirectUris).toEqual(['http://localhost:9999/callback'])
		expect(client.id).toBeTruthy()
	})

	test('getClient retrieves an existing client', () => {
		const created = createTestClient('Another Client ' + uniqueId())
		const retrieved = getClient(created.id)
		expect(retrieved).not.toBeNull()
		expect(retrieved!.name).toContain('Another Client')
	})

	test('getClient returns null for unknown client', () => {
		const client = getClient('nonexistent-id-' + uniqueId())
		expect(client).toBeNull()
	})

	test('deleteClient removes a client', () => {
		const client = createClient('Deletable Client ' + uniqueId(), [
			'http://example.com/callback',
		])
		const deleted = deleteClient(client.id)
		expect(deleted).toBe(true)
		expect(getClient(client.id)).toBeNull()
	})

	test('listClients returns clients', () => {
		const beforeCount = listClients().length
		createTestClient('List Test Client ' + uniqueId())
		const afterCount = listClients().length
		expect(afterCount).toBeGreaterThan(beforeCount)
	})
})

describe('Authorization codes', () => {
	test('createAuthorizationCode creates a code', async () => {
		const client = createTestClient('Code Test Client ' + uniqueId())
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const code = createAuthorizationCode({
			clientId: client.id,
			redirectUri: 'http://localhost:9999/callback',
			scope: 'read write',
			codeChallenge: challenge,
			codeChallengeMethod: 'S256',
		})

		expect(code.code).toBeTruthy()
		expect(code.clientId).toBe(client.id)
		expect(code.scope).toBe('read write')
		expect(code.usedAt).toBeNull()
	})

	test('consumeAuthorizationCode marks code as used', async () => {
		const client = createTestClient('Consume Test Client ' + uniqueId())
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const authCode = createAuthorizationCode({
			clientId: client.id,
			redirectUri: 'http://localhost:9999/callback',
			scope: 'read',
			codeChallenge: challenge,
			codeChallengeMethod: 'S256',
		})

		// First consumption should succeed
		const consumed = consumeAuthorizationCode(authCode.code)
		expect(consumed).not.toBeNull()
		expect(consumed!.usedAt).not.toBeNull()

		// Second consumption should fail (single-use)
		const secondConsume = consumeAuthorizationCode(authCode.code)
		expect(secondConsume).toBeNull()
	})
})

describe('OAuth full flow integration', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string
	let testClient: { id: string; redirectUris: string[] }

	beforeAll(async () => {
		// Create test client
		testClient = createTestClient('Integration Test Client ' + uniqueId(), [
			'http://localhost:9999/callback',
		])

		// Import and start the router
		const { default: router } = await import('#app/router.tsx')

		server = Bun.serve({
			port: 0, // Let OS assign a port
			async fetch(request) {
				return router.fetch(request)
			},
		})

		baseUrl = `http://localhost:${server.port}`
	})

	afterAll(() => {
		if (server) {
			server.stop()
		}
		// Clear key cache for clean state
		clearKeyCache()
	})

	test('JWKS endpoint returns valid JWK', async () => {
		const response = await fetch(`${baseUrl}/oauth/jwks`)
		expect(response.status).toBe(200)

		const jwks = (await response.json()) as {
			keys: Array<{
				kty: string
				use: string
				alg: string
				kid: string
				n: string
				e: string
				d?: string
			}>
		}
		expect(jwks.keys).toBeArray()
		expect(jwks.keys.length).toBe(1)

		const key = jwks.keys[0]!
		expect(key.kty).toBe('RSA')
		expect(key.use).toBe('sig')
		expect(key.alg).toBe('RS256')
		expect(key.kid).toBeTruthy()
		expect(key.n).toBeTruthy()
		expect(key.e).toBeTruthy()
		// Should NOT include private key components
		expect(key.d).toBeUndefined()
	})

	test('GET /admin/authorize shows authorization page', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			scope: 'read',
			state: 'test-state',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const response = await fetch(`${baseUrl}/admin/authorize?${params}`)
		expect(response.status).toBe(200)

		const html = await response.text()
		expect(html).toContain('Authorize')
		expect(html).toContain('Integration Test Client')
	})

	test('GET /admin/authorize rejects invalid client', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: 'invalid-client-id-' + uniqueId(),
			redirect_uri: 'http://localhost/callback',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const response = await fetch(`${baseUrl}/admin/authorize?${params}`)
		expect(response.status).toBe(400)

		const html = await response.text()
		expect(html).toContain('Invalid Client')
	})

	test('GET /admin/authorize requires PKCE', async () => {
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
		})

		const response = await fetch(`${baseUrl}/admin/authorize?${params}`)
		expect(response.status).toBe(400)

		const html = await response.text()
		expect(html).toContain('PKCE Required')
	})

	test('POST /admin/authorize issues authorization code', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			scope: 'read',
			state: 'my-state',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const response = await fetch(`${baseUrl}/admin/authorize?${params}`, {
			method: 'POST',
			redirect: 'manual',
		})

		expect(response.status).toBe(302)

		const location = response.headers.get('Location')
		expect(location).toBeTruthy()

		const redirectUrl = new URL(location!)
		expect(redirectUrl.origin).toBe('http://localhost:9999')
		expect(redirectUrl.pathname).toBe('/callback')
		expect(redirectUrl.searchParams.get('code')).toBeTruthy()
		expect(redirectUrl.searchParams.get('state')).toBe('my-state')
	})

	test('Full authorization code flow with token exchange', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Step 1: Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			scope: 'read write',
			state: 'flow-state',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

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

		// Step 2: Exchange code for token
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
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
		expect(tokenData.expires_in).toBe(3600)
		expect(tokenData.scope).toBe('read write')

		// Step 3: Verify token is a valid JWT
		const { access_token } = tokenData

		// Get JWKS and verify token
		const jwksResponse = await fetch(`${baseUrl}/oauth/jwks`)
		const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
		const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

		const { payload } = await jose.jwtVerify(access_token, publicKey, {
			issuer: baseUrl,
			audience: getAudience(),
		})

		expect(payload.iss).toBe(baseUrl)
		expect(payload.aud).toBe(getAudience())
		expect(payload.sub).toBe(getSubject())
		expect(payload.scope).toBe('read write')
		expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
	})

	test('Token endpoint rejects wrong PKCE verifier', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// Try to exchange with wrong verifier
		const wrongVerifier = generateCodeVerifier()
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
				code_verifier: wrongVerifier,
			}).toString(),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
			error_description: string
		}
		expect(errorData.error).toBe('invalid_grant')
		expect(errorData.error_description).toContain('PKCE')
	})

	test('Token endpoint rejects missing PKCE verifier', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// Try to exchange without verifier
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
			}).toString(),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
			error_description: string
		}
		expect(errorData.error).toBe('invalid_request')
		expect(errorData.error_description).toContain('code_verifier')
	})

	test('Authorization code cannot be reused', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// First exchange should succeed
		const firstTokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
				code_verifier: verifier,
			}).toString(),
		})

		expect(firstTokenResponse.status).toBe(200)

		// Second exchange with same code should fail
		const secondTokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
				code_verifier: verifier,
			}).toString(),
		})

		expect(secondTokenResponse.status).toBe(400)

		const errorData = (await secondTokenResponse.json()) as {
			error: string
			error_description: string
		}
		expect(errorData.error).toBe('invalid_grant')
		expect(errorData.error_description).toContain('already been used')
	})

	test('Token endpoint rejects wrong redirect_uri', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// Try to exchange with different redirect_uri
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: 'http://evil.com/callback',
				client_id: testClient.id,
				code_verifier: verifier,
			}).toString(),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
			error_description: string
		}
		expect(errorData.error).toBe('invalid_grant')
		expect(errorData.error_description).toContain('redirect_uri')
	})

	test('Token endpoint rejects wrong client_id', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// Create another client
		const otherClient = createTestClient('Other Client ' + uniqueId(), [
			'http://other.com/callback',
		])

		// Try to exchange with different client_id
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: otherClient.id,
				code_verifier: verifier,
			}).toString(),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
		}
		expect(errorData.error).toBe('invalid_grant')
	})

	test('Token endpoint rejects unsupported grant type', async () => {
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'password',
				username: 'test',
				password: 'test',
			}).toString(),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
		}
		expect(errorData.error).toBe('unsupported_grant_type')
	})

	test('Token endpoint rejects wrong content type', async () => {
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				grant_type: 'authorization_code',
				code: 'test',
			}),
		})

		expect(tokenResponse.status).toBe(400)

		const errorData = (await tokenResponse.json()) as {
			error: string
		}
		expect(errorData.error).toBe('invalid_request')
	})

	test('Token endpoint only allows POST', async () => {
		const response = await fetch(`${baseUrl}/oauth/token`, {
			method: 'GET',
		})

		expect(response.status).toBe(405)
	})

	test('JWKS endpoint only allows GET', async () => {
		const response = await fetch(`${baseUrl}/oauth/jwks`, {
			method: 'POST',
		})

		expect(response.status).toBe(405)
	})

	test('JWT token has correct claims structure', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		// Get authorization code
		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: testClient.redirectUris[0]!,
			scope: 'mcp:read',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authorizeResponse = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
			{
				method: 'POST',
				redirect: 'manual',
			},
		)

		const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
		const code = redirectUrl.searchParams.get('code')!

		// Exchange for token
		const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: testClient.redirectUris[0]!,
				client_id: testClient.id,
				code_verifier: verifier,
			}).toString(),
		})

		const tokenData = (await tokenResponse.json()) as { access_token: string }

		// Decode token header without verification
		const parts = tokenData.access_token.split('.')
		const header = JSON.parse(atob(parts[0]!)) as { alg: string; kid: string }

		expect(header.alg).toBe('RS256')
		expect(header.kid).toBeTruthy()

		// Verify full token
		const jwksResponse = await fetch(`${baseUrl}/oauth/jwks`)
		const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
		const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

		const { payload, protectedHeader } = await jose.jwtVerify(
			tokenData.access_token,
			publicKey,
		)

		expect(protectedHeader.alg).toBe('RS256')
		expect(payload.iss).toBe(baseUrl)
		expect(payload.aud).toBe('mcp-server')
		expect(payload.sub).toBe('user')
		expect(payload.scope).toBe('mcp:read')
		expect(typeof payload.iat).toBe('number')
		expect(typeof payload.exp).toBe('number')
		expect(payload.exp! - payload.iat!).toBe(3600)
	})
})
