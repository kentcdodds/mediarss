// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import { afterAll, expect, test } from 'bun:test'
import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import { resetRateLimiters } from '#app/helpers/rate-limiter.ts'
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

/**
 * Creates a test server that will be automatically stopped.
 */
async function createTestServer() {
	resetRateLimiters()
	const { default: router } = await import('#app/router.tsx')

	const server = Bun.serve({
		port: 0, // Let OS assign a port
		async fetch(request) {
			return router.fetch(request)
		},
	})

	const baseUrl = `http://localhost:${server.port}`

	return {
		server,
		baseUrl,
		[Symbol.dispose]: () => {
			server.stop()
			clearKeyCache()
			resetRateLimiters()
		},
	}
}

// Clean up test data after all tests
afterAll(() => {
	for (const clientId of testClientIds) {
		deleteClient(clientId)
	}
	// Clean up any orphaned test authorization codes
	db.run(sql`DELETE FROM authorization_codes WHERE client_id LIKE 'test-%';`)
})

// PKCE Tests

test('PKCE generates valid verifiers and computes correct S256 challenges', async () => {
	// generateCodeVerifier produces valid verifiers
	const verifier = generateCodeVerifier()
	expect(isValidCodeVerifier(verifier)).toBe(true)
	expect(verifier.length).toBeGreaterThanOrEqual(43)

	// computeS256Challenge produces correct challenge (RFC 7636 test vector)
	const knownVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
	const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
	await expect(computeS256Challenge(knownVerifier)).resolves.toBe(
		expectedChallenge,
	)

	// verifyCodeChallenge returns true for valid pair
	const challenge = await computeS256Challenge(verifier)
	await expect(verifyCodeChallenge(verifier, challenge, 'S256')).resolves.toBe(
		true,
	)

	// verifyCodeChallenge returns false for invalid verifier
	const wrongVerifier = generateCodeVerifier()
	await expect(
		verifyCodeChallenge(wrongVerifier, challenge, 'S256'),
	).resolves.toBe(false)

	// verifyCodeChallenge rejects non-S256 methods
	await expect(verifyCodeChallenge(verifier, challenge, 'plain')).resolves.toBe(
		false,
	)

	// isValidCodeVerifier rejects short verifiers
	expect(isValidCodeVerifier('short')).toBe(false)

	// isValidCodeVerifier rejects invalid characters
	const invalidVerifier = 'a'.repeat(43) + '!'
	expect(isValidCodeVerifier(invalidVerifier)).toBe(false)

	// isValidCodeChallenge validates length
	expect(isValidCodeChallenge('short')).toBe(false)
	expect(
		isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'),
	).toBe(true)
})

// OAuth Client Tests

test('OAuth clients can be created, retrieved, listed, and deleted', () => {
	// createClient creates a client
	const client = createTestClient('Test Client ' + uniqueId())
	expect(client.name).toContain('Test Client')
	expect(client.redirectUris).toEqual(['http://localhost:9999/callback'])
	expect(client.id).toBeTruthy()

	// getClient retrieves an existing client
	const retrieved = getClient(client.id)
	expect(retrieved).not.toBeNull()
	expect(retrieved!.name).toContain('Test Client')

	// getClient returns null for unknown client
	expect(getClient('nonexistent-id-' + uniqueId())).toBeNull()

	// listClients includes the created client
	const beforeCount = listClients().length
	createTestClient('List Test Client ' + uniqueId())
	const afterCount = listClients().length
	expect(afterCount).toBeGreaterThan(beforeCount)

	// deleteClient removes a client (not using tracked cleanup for this one)
	const deletableClient = createClient('Deletable Client ' + uniqueId(), [
		'http://example.com/callback',
	])
	expect(deleteClient(deletableClient.id)).toBe(true)
	expect(getClient(deletableClient.id)).toBeNull()
})

// Authorization Code Tests

test('authorization codes can be created and consumed only once', async () => {
	const client = createTestClient('Code Test Client ' + uniqueId())
	const verifier = generateCodeVerifier()
	const challenge = await computeS256Challenge(verifier)

	// Create authorization code
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

	// First consumption should succeed
	const consumed = consumeAuthorizationCode(code.code)
	expect(consumed).not.toBeNull()
	expect(consumed!.usedAt).not.toBeNull()

	// Second consumption should fail (single-use)
	expect(consumeAuthorizationCode(code.code)).toBeNull()
})

// OAuth Full Flow Integration Tests

test('JWKS endpoint returns valid public key without private components', async () => {
	using ctx = await createTestServer()

	const response = await fetch(`${ctx.baseUrl}/oauth/jwks`)
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

test('authorization endpoint shows page, validates client, and requires PKCE', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Auth Endpoint Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
	const verifier = generateCodeVerifier()
	const challenge = await computeS256Challenge(verifier)

	// GET shows authorization page for valid client
	const validParams = new URLSearchParams({
		response_type: 'code',
		client_id: testClient.id,
		redirect_uri: testClient.redirectUris[0]!,
		scope: 'read',
		state: 'test-state',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	})

	const validResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${validParams}`,
	)
	expect(validResponse.status).toBe(200)
	const html = await validResponse.text()
	expect(html).toContain('Authorize')
	expect(html).toContain('Auth Endpoint Test')

	// Rejects invalid client
	const invalidClientParams = new URLSearchParams({
		response_type: 'code',
		client_id: 'invalid-client-id-' + uniqueId(),
		redirect_uri: 'http://localhost/callback',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	})

	const invalidClientResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${invalidClientParams}`,
	)
	expect(invalidClientResponse.status).toBe(400)
	const invalidHtml = await invalidClientResponse.text()
	expect(invalidHtml).toContain('Invalid Client')

	// Requires PKCE
	const noPkceParams = new URLSearchParams({
		response_type: 'code',
		client_id: testClient.id,
		redirect_uri: testClient.redirectUris[0]!,
	})

	const noPkceResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${noPkceParams}`,
	)
	expect(noPkceResponse.status).toBe(400)
	const noPkceHtml = await noPkceResponse.text()
	expect(noPkceHtml).toContain('PKCE Required')
})

test('POST to authorization endpoint issues authorization code with state', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('POST Auth Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
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

	const response = await fetch(`${ctx.baseUrl}/admin/authorize?${params}`, {
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

test('full OAuth authorization code flow with token exchange and JWT verification', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Full Flow Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
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
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	expect(authorizeResponse.status).toBe(302)
	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!

	// Step 2: Exchange code for token
	const tokenResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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
	const jwksResponse = await fetch(`${ctx.baseUrl}/oauth/jwks`)
	const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
	const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

	const { payload } = await jose.jwtVerify(tokenData.access_token, publicKey, {
		issuer: ctx.baseUrl,
		audience: getAudience(),
	})

	expect(payload.iss).toBe(ctx.baseUrl)
	expect(payload.aud).toBe(getAudience())
	expect(payload.sub).toBe(getSubject())
	expect(payload.scope).toBe('read write')
	expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
})

test('token endpoint rejects requests with invalid PKCE verifier or missing verifier', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('PKCE Reject Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
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
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!

	// Try with wrong verifier
	const wrongVerifier = generateCodeVerifier()
	const wrongVerifierResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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

	expect(wrongVerifierResponse.status).toBe(400)
	const wrongVerifierError = (await wrongVerifierResponse.json()) as {
		error: string
		error_description: string
	}
	expect(wrongVerifierError.error).toBe('invalid_grant')
	expect(wrongVerifierError.error_description).toContain('PKCE')

	// Get another code for missing verifier test
	const authorizeResponse2 = await fetch(
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)
	const code2 = new URL(
		authorizeResponse2.headers.get('Location')!,
	).searchParams.get('code')!

	// Try without verifier
	const noVerifierResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: code2,
			redirect_uri: testClient.redirectUris[0]!,
			client_id: testClient.id,
		}).toString(),
	})

	expect(noVerifierResponse.status).toBe(400)
	const noVerifierError = (await noVerifierResponse.json()) as {
		error: string
		error_description: string
	}
	expect(noVerifierError.error).toBe('invalid_request')
	expect(noVerifierError.error_description).toContain('code_verifier')
})

test('authorization code cannot be reused', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Code Reuse Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
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
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!

	// First exchange should succeed
	const firstTokenResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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
	const secondTokenResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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

test('token endpoint validates redirect_uri and client_id match the authorization code', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Validation Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
	const otherClient = createTestClient('Other Client ' + uniqueId(), [
		'http://other.com/callback',
	])
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
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!

	// Try with wrong redirect_uri
	const wrongRedirectResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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

	expect(wrongRedirectResponse.status).toBe(400)
	const redirectError = (await wrongRedirectResponse.json()) as {
		error: string
		error_description: string
	}
	expect(redirectError.error).toBe('invalid_grant')
	expect(redirectError.error_description).toContain('redirect_uri')

	// Get another code for wrong client_id test
	const authorizeResponse2 = await fetch(
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)
	const code2 = new URL(
		authorizeResponse2.headers.get('Location')!,
	).searchParams.get('code')!

	// Try with wrong client_id
	const wrongClientResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: code2,
			redirect_uri: testClient.redirectUris[0]!,
			client_id: otherClient.id,
			code_verifier: verifier,
		}).toString(),
	})

	expect(wrongClientResponse.status).toBe(400)
	expect(((await wrongClientResponse.json()) as { error: string }).error).toBe(
		'invalid_grant',
	)
})

test('token endpoint rejects unsupported grant types and wrong content type', async () => {
	using ctx = await createTestServer()

	// Unsupported grant type
	const unsupportedGrantResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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

	expect(unsupportedGrantResponse.status).toBe(400)
	expect(
		((await unsupportedGrantResponse.json()) as { error: string }).error,
	).toBe('unsupported_grant_type')

	// Wrong content type
	const wrongContentTypeResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			grant_type: 'authorization_code',
			code: 'test',
		}),
	})

	expect(wrongContentTypeResponse.status).toBe(400)
	expect(
		((await wrongContentTypeResponse.json()) as { error: string }).error,
	).toBe('invalid_request')
})

test('OAuth endpoints enforce correct HTTP methods', async () => {
	using ctx = await createTestServer()

	// Token endpoint only allows POST
	const tokenGetResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
		method: 'GET',
	})
	expect(tokenGetResponse.status).toBe(405)

	// JWKS endpoint only allows GET
	const jwksPostResponse = await fetch(`${ctx.baseUrl}/oauth/jwks`, {
		method: 'POST',
	})
	expect(jwksPostResponse.status).toBe(405)
})

test('JWT token has correct claims structure', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('JWT Claims Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
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
		`${ctx.baseUrl}/admin/authorize?${authorizeParams}`,
		{
			method: 'POST',
			redirect: 'manual',
		},
	)

	const redirectUrl = new URL(authorizeResponse.headers.get('Location')!)
	const code = redirectUrl.searchParams.get('code')!

	// Exchange for token
	const tokenResponse = await fetch(`${ctx.baseUrl}/oauth/token`, {
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
	const jwksResponse = await fetch(`${ctx.baseUrl}/oauth/jwks`)
	const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
	const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

	const { payload, protectedHeader } = await jose.jwtVerify(
		tokenData.access_token,
		publicKey,
	)

	expect(protectedHeader.alg).toBe('RS256')
	expect(payload.iss).toBe(ctx.baseUrl)
	expect(payload.aud).toBe('mcp-server')
	expect(payload.sub).toBe('user')
	expect(payload.scope).toBe('mcp:read')
	expect(typeof payload.iat).toBe('number')
	expect(typeof payload.exp).toBe('number')
	expect(payload.exp! - payload.iat!).toBe(3600)
})
