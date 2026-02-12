// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import { afterAll, afterEach, expect, test } from 'bun:test'
import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import { resetRateLimiters } from '#app/helpers/rate-limiter.ts'
import { consoleError } from '#test/setup.ts'
import {
	clearKeyCache,
	clearMetadataCache,
	clientSupportsGrantType,
	computeS256Challenge,
	createClient,
	deleteClient,
	generateCodeVerifier,
	getAudience,
	getClientMetadata,
	isUrlClientId,
	isValidClientRedirectUri,
	resolveClient,
} from './index.ts'

// Ensure migrations are run
migrate(db)

// Helper to generate unique test IDs
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
 * Creates a test server with full OAuth routes.
 */
async function createTestServer() {
	resetRateLimiters()
	const { default: router } = await import('#app/router.tsx')

	const server = Bun.serve({
		port: 0,
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

// Mock fetch for URL-based client metadata tests
const originalFetch = globalThis.fetch
let mockFetchResponses: Map<string, () => Response | Promise<Response>>

function setupMockFetch() {
	mockFetchResponses = new Map()

	// Mock global fetch for HTTPS URLs
	const mockFetch = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url

			// Check if we have a mock response for this URL
			const mockResponseFn = mockFetchResponses.get(url)
			if (mockResponseFn) {
				return mockResponseFn()
			}

			// For non-mocked URLs, use original fetch (e.g., localhost test server)
			return originalFetch(input, init)
		},
		{
			preconnect: originalFetch.preconnect.bind(originalFetch),
		},
	)
	globalThis.fetch = mockFetch as typeof fetch

	return {
		mockFetchResponses,
		[Symbol.dispose]: () => {
			globalThis.fetch = originalFetch
			clearMetadataCache()
			// Clean up test metadata from DB
			db.run(
				sql`DELETE FROM client_metadata_cache WHERE client_id LIKE 'https://test-%';`,
			)
		},
	}
}

afterAll(() => {
	// Clean up test clients
	for (const clientId of testClientIds) {
		deleteClient(clientId)
	}
	// Clean up test metadata cache
	db.run(
		sql`DELETE FROM client_metadata_cache WHERE client_id LIKE '%localhost%';`,
	)
})

afterEach(() => {
	clearMetadataCache()
})

// URL Client ID Detection Tests

test('isUrlClientId correctly identifies URL-based vs simple client IDs', () => {
	// Valid HTTPS URLs should be detected as URL client IDs
	expect(isUrlClientId('https://example.com/client')).toBe(true)
	expect(isUrlClientId('https://client.example.com')).toBe(true)
	expect(isUrlClientId('https://example.com:8443/client')).toBe(true)
	expect(isUrlClientId('https://client.example.com/metadata.json')).toBe(true)

	// HTTP URLs should not be valid for metadata documents (security)
	expect(isUrlClientId('http://example.com/client')).toBe(false)
	expect(isUrlClientId('http://insecure.example.com')).toBe(false)

	// Non-URL strings should not be detected
	expect(isUrlClientId('mcp-client')).toBe(false)
	expect(isUrlClientId('my-app')).toBe(false)
	expect(isUrlClientId('')).toBe(false)
	expect(isUrlClientId('not-a-url')).toBe(false)
	expect(isUrlClientId('ftp://example.com')).toBe(false)
	expect(isUrlClientId('simple-client-id')).toBe(false)
})

// Static Client Resolution Tests

test('resolveClient resolves static clients and returns null for unknown clients', async () => {
	const staticClient = createTestClient('Static Test ' + uniqueId(), [
		'http://localhost:3000/callback',
	])

	// Should resolve to static client
	const resolved = await resolveClient(staticClient.id)
	expect(resolved).not.toBeNull()
	expect(resolved!.id).toBe(staticClient.id)
	expect(resolved!.name).toContain('Static Test')
	expect(resolved!.redirectUris).toEqual(['http://localhost:3000/callback'])
	expect(resolved!.isMetadataClient).toBe(false)

	// Should return null for unknown static client
	await expect(
		resolveClient('nonexistent-client-' + uniqueId()),
	).resolves.toBeNull()
})

test('static clients take precedence over URL lookups for non-URL IDs', async () => {
	const staticClient = createTestClient('Precedence Test ' + uniqueId(), [
		'http://localhost:5000/callback',
	])

	// Should resolve to static client, not try URL lookup
	const resolved = await resolveClient(staticClient.id)
	expect(resolved).not.toBeNull()
	expect(resolved!.isMetadataClient).toBe(false)
	expect(resolved!.id).toBe(staticClient.id)
})

// Redirect URI Validation Tests

test('isValidClientRedirectUri validates redirect URIs for static clients', async () => {
	const staticClient = createTestClient('URI Test ' + uniqueId(), [
		'http://localhost:3000/callback',
		'http://localhost:8080/callback',
	])

	const resolved = await resolveClient(staticClient.id)
	expect(resolved).not.toBeNull()

	// Valid URIs
	expect(
		isValidClientRedirectUri(resolved!, 'http://localhost:3000/callback'),
	).toBe(true)
	expect(
		isValidClientRedirectUri(resolved!, 'http://localhost:8080/callback'),
	).toBe(true)

	// Invalid URI
	expect(isValidClientRedirectUri(resolved!, 'http://evil.com/callback')).toBe(
		false,
	)
})

// Grant Type Validation Tests

test('clientSupportsGrantType validates grant types correctly', async () => {
	const staticClient = createTestClient('Grant Test ' + uniqueId(), [
		'http://localhost:3000/callback',
	])

	const resolved = await resolveClient(staticClient.id)
	expect(resolved).not.toBeNull()

	// Static clients default to authorization_code grant type
	expect(clientSupportsGrantType(resolved!, 'authorization_code')).toBe(true)
	expect(clientSupportsGrantType(resolved!, 'client_credentials')).toBe(false)
	expect(clientSupportsGrantType(resolved!, 'refresh_token')).toBe(false)

	// Custom grant types array validation
	const clientWithOnlyClientCredentials = {
		id: 'test-client',
		name: 'Test Client',
		redirectUris: ['http://localhost:3000/callback'],
		grantTypes: ['client_credentials'],
		isMetadataClient: true,
	}

	expect(
		clientSupportsGrantType(
			clientWithOnlyClientCredentials,
			'client_credentials',
		),
	).toBe(true)
	expect(
		clientSupportsGrantType(
			clientWithOnlyClientCredentials,
			'authorization_code',
		),
	).toBe(false)
})

// Server Metadata Tests

test('server metadata indicates DCR and client ID metadata document support', async () => {
	using ctx = await createTestServer()

	const response = await fetch(
		`${ctx.baseUrl}/.well-known/oauth-authorization-server`,
	)
	expect(response.status).toBe(200)

	const metadata = (await response.json()) as {
		issuer: string
		authorization_endpoint: string
		token_endpoint: string
		jwks_uri: string
		scopes_supported: string[]
		response_types_supported: string[]
		grant_types_supported: string[]
		code_challenge_methods_supported: string[]
		token_endpoint_auth_methods_supported: string[]
		client_id_metadata_document_supported: boolean
		registration_endpoint: string
	}

	expect(metadata.issuer).toBe(ctx.baseUrl)
	expect(metadata.authorization_endpoint).toBe(`${ctx.baseUrl}/admin/authorize`)
	expect(metadata.token_endpoint).toBe(`${ctx.baseUrl}/oauth/token`)
	expect(metadata.jwks_uri).toBe(`${ctx.baseUrl}/oauth/jwks`)
	expect(metadata.scopes_supported).toContain('mcp:read')
	expect(metadata.scopes_supported).toContain('mcp:write')
	expect(metadata.response_types_supported).toContain('code')
	expect(metadata.grant_types_supported).toContain('authorization_code')
	expect(metadata.code_challenge_methods_supported).toContain('S256')

	// MCP 2025-11-25 spec compliance
	expect(metadata.client_id_metadata_document_supported).toBe(true)
	expect(metadata.registration_endpoint).toBe(`${ctx.baseUrl}/oauth/register`)

	// Cache headers
	const cacheControl = response.headers.get('Cache-Control')
	expect(cacheControl).toContain('max-age')
})

// Full OAuth Flow with Static Client

test('full authorization code flow with static client', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Flow Test ' + uniqueId(), [
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
		state: 'metadata-test-state',
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
	expect(tokenData.scope).toBe('read write')

	// Step 3: Verify token
	const jwksResponse = await fetch(`${ctx.baseUrl}/oauth/jwks`)
	const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
	const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

	const { payload } = await jose.jwtVerify(tokenData.access_token, publicKey, {
		issuer: ctx.baseUrl,
		audience: getAudience(),
	})

	expect(payload.iss).toBe(ctx.baseUrl)
	expect(payload.scope).toBe('read write')
})

test('authorization endpoint rejects unknown and invalid redirect URIs', async () => {
	using ctx = await createTestServer()

	const testClient = createTestClient('Reject Test ' + uniqueId(), [
		'http://localhost:9999/callback',
	])
	const verifier = generateCodeVerifier()
	const challenge = await computeS256Challenge(verifier)

	// Unknown client ID
	const unknownClientParams = new URLSearchParams({
		response_type: 'code',
		client_id: 'unknown-client-' + uniqueId(),
		redirect_uri: 'http://localhost:9999/callback',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	})

	const unknownClientResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${unknownClientParams}`,
	)
	expect(unknownClientResponse.status).toBe(400)
	expect(await unknownClientResponse.text()).toContain('Invalid Client')

	// Invalid redirect URI for static client
	const invalidUriParams = new URLSearchParams({
		response_type: 'code',
		client_id: testClient.id,
		redirect_uri: 'http://evil.com/callback', // Not registered
		code_challenge: challenge,
		code_challenge_method: 'S256',
	})

	const invalidUriResponse = await fetch(
		`${ctx.baseUrl}/admin/authorize?${invalidUriParams}`,
	)
	expect(invalidUriResponse.status).toBe(400)
	expect(await invalidUriResponse.text()).toContain('Invalid Redirect URI')
})

// URL-based Client ID Metadata Document Tests

test('getClientMetadata fetches and validates metadata documents', async () => {
	using mockCtx = setupMockFetch()

	// Valid metadata document
	const validClientUrl = 'https://test-valid-client.example.com/oauth/metadata'
	const validMetadata = {
		client_id: validClientUrl,
		client_name: 'Test MCP Client',
		redirect_uris: ['https://test-valid-client.example.com/callback'],
		grant_types: ['authorization_code'],
		response_types: ['code'],
	}

	mockCtx.mockFetchResponses.set(validClientUrl, () =>
		Response.json(validMetadata, {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'max-age=3600',
			},
		}),
	)

	const result = await getClientMetadata(validClientUrl)
	expect(result).not.toBeNull()
	expect(result!.client_id).toBe(validClientUrl)
	expect(result!.client_name).toBe('Test MCP Client')
	expect(result!.redirect_uris).toEqual([
		'https://test-valid-client.example.com/callback',
	])
	expect(result!.grant_types).toEqual(['authorization_code'])

	// Metadata with multiple redirect URIs
	const multiRedirectUrl = 'https://test-multi-redirect.example.com/metadata'
	mockCtx.mockFetchResponses.set(multiRedirectUrl, () =>
		Response.json(
			{
				client_id: multiRedirectUrl,
				redirect_uris: [
					'https://app.example.com/callback',
					'https://staging.example.com/callback',
					'http://localhost:3000/callback',
				],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const multiResult = await getClientMetadata(multiRedirectUrl)
	expect(multiResult).not.toBeNull()
	expect(multiResult!.redirect_uris).toHaveLength(3)
	expect(multiResult!.redirect_uris).toContain(
		'https://app.example.com/callback',
	)
	expect(multiResult!.redirect_uris).toContain('http://localhost:3000/callback')

	// Minimal metadata (optional fields omitted)
	const minimalUrl = 'https://test-minimal.example.com/metadata'
	mockCtx.mockFetchResponses.set(minimalUrl, () =>
		Response.json(
			{
				client_id: minimalUrl,
				redirect_uris: ['https://test-minimal.example.com/callback'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const minimalResult = await getClientMetadata(minimalUrl)
	expect(minimalResult).not.toBeNull()
	expect(minimalResult!.client_id).toBe(minimalUrl)
	expect(minimalResult!.client_name).toBeUndefined()
	expect(minimalResult!.grant_types).toBeUndefined()

	// Non-URL client IDs return null
	await expect(getClientMetadata('simple-client-id')).resolves.toBeNull()

	// HTTP (non-HTTPS) URLs return null
	await expect(
		getClientMetadata('http://insecure.example.com/metadata'),
	).resolves.toBeNull()
})

test('getClientMetadata rejects invalid metadata documents', async () => {
	using mockCtx = setupMockFetch()

	// Suppress expected console.error from validation failures
	consoleError.mockImplementation(() => {})

	// client_id does not match URL
	const mismatchUrl = 'https://test-mismatch.example.com/metadata'
	mockCtx.mockFetchResponses.set(mismatchUrl, () =>
		Response.json(
			{
				client_id: 'https://different-domain.example.com/metadata',
				redirect_uris: ['https://test-mismatch.example.com/callback'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(mismatchUrl)).resolves.toBeNull()

	// Empty redirect_uris array
	const emptyRedirectsUrl = 'https://test-empty-redirects.example.com/metadata'
	mockCtx.mockFetchResponses.set(emptyRedirectsUrl, () =>
		Response.json(
			{
				client_id: emptyRedirectsUrl,
				redirect_uris: [],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(emptyRedirectsUrl)).resolves.toBeNull()

	// Missing redirect_uris
	const missingRedirectsUrl =
		'https://test-missing-redirects.example.com/metadata'
	mockCtx.mockFetchResponses.set(missingRedirectsUrl, () =>
		Response.json(
			{ client_id: missingRedirectsUrl },
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(missingRedirectsUrl)).resolves.toBeNull()

	// Invalid redirect URI format
	const invalidUriUrl = 'https://test-invalid-uri.example.com/metadata'
	mockCtx.mockFetchResponses.set(invalidUriUrl, () =>
		Response.json(
			{
				client_id: invalidUriUrl,
				redirect_uris: ['not-a-valid-url'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(invalidUriUrl)).resolves.toBeNull()

	// Non-string redirect URI
	const wrongTypeUrl = 'https://test-wrong-type.example.com/metadata'
	mockCtx.mockFetchResponses.set(wrongTypeUrl, () =>
		Response.json(
			{
				client_id: wrongTypeUrl,
				redirect_uris: [12345],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(wrongTypeUrl)).resolves.toBeNull()

	// Invalid grant_types type
	const invalidGrantsUrl = 'https://test-invalid-grants.example.com/metadata'
	mockCtx.mockFetchResponses.set(invalidGrantsUrl, () =>
		Response.json(
			{
				client_id: invalidGrantsUrl,
				redirect_uris: ['https://test-invalid-grants.example.com/callback'],
				grant_types: 'authorization_code', // Should be array
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)
	await expect(getClientMetadata(invalidGrantsUrl)).resolves.toBeNull()
})

test('getClientMetadata handles fetch errors gracefully', async () => {
	using mockCtx = setupMockFetch()

	// Suppress expected console.error from fetch failures
	consoleError.mockImplementation(() => {})

	// 404 response
	const notFoundUrl = 'https://test-404.example.com/metadata'
	mockCtx.mockFetchResponses.set(
		notFoundUrl,
		() => new Response('Not Found', { status: 404 }),
	)
	await expect(getClientMetadata(notFoundUrl)).resolves.toBeNull()

	// 500 server error
	const serverErrorUrl = 'https://test-500.example.com/metadata'
	mockCtx.mockFetchResponses.set(
		serverErrorUrl,
		() => new Response('Internal Server Error', { status: 500 }),
	)
	await expect(getClientMetadata(serverErrorUrl)).resolves.toBeNull()

	// Non-JSON content type
	const wrongContentUrl = 'https://test-wrong-content.example.com/metadata'
	mockCtx.mockFetchResponses.set(
		wrongContentUrl,
		() =>
			new Response('<html>Not JSON</html>', {
				status: 200,
				headers: { 'Content-Type': 'text/html' },
			}),
	)
	await expect(getClientMetadata(wrongContentUrl)).resolves.toBeNull()

	// Invalid JSON response
	const badJsonUrl = 'https://test-bad-json.example.com/metadata'
	mockCtx.mockFetchResponses.set(
		badJsonUrl,
		() =>
			new Response('{ invalid json }', {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
	)
	await expect(getClientMetadata(badJsonUrl)).resolves.toBeNull()

	// Network errors
	const networkErrorUrl = 'https://test-network-error.example.com/metadata'
	mockCtx.mockFetchResponses.set(networkErrorUrl, () => {
		throw new Error('Network error')
	})
	await expect(getClientMetadata(networkErrorUrl)).resolves.toBeNull()
})

test('getClientMetadata caches metadata in memory and database', async () => {
	using mockCtx = setupMockFetch()

	const clientIdUrl = 'https://test-cache-memory.example.com/metadata'
	let fetchCount = 0
	const metadata = {
		client_id: clientIdUrl,
		redirect_uris: ['https://test-cache-memory.example.com/callback'],
	}

	mockCtx.mockFetchResponses.set(clientIdUrl, () => {
		fetchCount++
		return Response.json(metadata, {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'max-age=3600',
			},
		})
	})

	// First call - should fetch
	const result1 = await getClientMetadata(clientIdUrl)
	expect(result1).not.toBeNull()
	expect(fetchCount).toBe(1)

	// Second call - should use memory cache
	const result2 = await getClientMetadata(clientIdUrl)
	expect(result2).not.toBeNull()
	expect(result2!.client_id).toBe(clientIdUrl)
	expect(fetchCount).toBe(1) // No additional fetch

	// Verify database cache
	const row = db
		.query<{ client_id: string; metadata_json: string }, [string]>(
			sql`SELECT * FROM client_metadata_cache WHERE client_id = ?;`,
		)
		.get(clientIdUrl)

	expect(row).not.toBeNull()
	expect(row!.client_id).toBe(clientIdUrl)

	const cachedMetadata = JSON.parse(row!.metadata_json)
	expect(cachedMetadata.client_id).toBe(clientIdUrl)

	// Clear memory cache and verify DB cache fallback
	clearMetadataCache()

	// Should retrieve from DB cache, not fetch again
	const result3 = await getClientMetadata(clientIdUrl)
	expect(result3).not.toBeNull()
	expect(result3!.client_id).toBe(clientIdUrl)
	expect(fetchCount).toBe(1) // Still no additional fetch
})

test('metadata cache respects Cache-Control headers with min/max bounds', async () => {
	using mockCtx = setupMockFetch()

	// Test that max-age is respected
	const ttlTestUrl = 'https://test-cache-ttl.example.com/metadata'
	mockCtx.mockFetchResponses.set(ttlTestUrl, () =>
		Response.json(
			{
				client_id: ttlTestUrl,
				redirect_uris: ['https://test-cache-ttl.example.com/callback'],
			},
			{
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'max-age=600', // 10 minutes
				},
			},
		),
	)

	await getClientMetadata(ttlTestUrl)

	const ttlRow = db
		.query<{ expires_at: number; cached_at: number }, [string]>(
			sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
		)
		.get(ttlTestUrl)

	expect(ttlRow).not.toBeNull()
	const ttlDuration = ttlRow!.expires_at - ttlRow!.cached_at
	expect(ttlDuration).toBe(600) // Should match max-age

	clearMetadataCache()

	// Test minimum cache duration enforcement
	const minCacheUrl = 'https://test-min-cache.example.com/metadata'
	mockCtx.mockFetchResponses.set(minCacheUrl, () =>
		Response.json(
			{
				client_id: minCacheUrl,
				redirect_uris: ['https://test-min-cache.example.com/callback'],
			},
			{
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'max-age=60', // Only 1 minute
				},
			},
		),
	)

	await getClientMetadata(minCacheUrl)

	const minRow = db
		.query<{ expires_at: number; cached_at: number }, [string]>(
			sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
		)
		.get(minCacheUrl)

	expect(minRow).not.toBeNull()
	const minDuration = minRow!.expires_at - minRow!.cached_at
	expect(minDuration).toBe(300) // Should be enforced minimum (5 minutes)

	clearMetadataCache()

	// Test maximum cache duration enforcement
	const maxCacheUrl = 'https://test-max-cache.example.com/metadata'
	mockCtx.mockFetchResponses.set(maxCacheUrl, () =>
		Response.json(
			{
				client_id: maxCacheUrl,
				redirect_uris: ['https://test-max-cache.example.com/callback'],
			},
			{
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'max-age=999999', // Very long
				},
			},
		),
	)

	await getClientMetadata(maxCacheUrl)

	const maxRow = db
		.query<{ expires_at: number; cached_at: number }, [string]>(
			sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
		)
		.get(maxCacheUrl)

	expect(maxRow).not.toBeNull()
	const maxDuration = maxRow!.expires_at - maxRow!.cached_at
	expect(maxDuration).toBe(86400) // Should be enforced maximum (24 hours)
})

test('resolveClient resolves URL-based clients from metadata documents', async () => {
	using mockCtx = setupMockFetch()

	// Valid URL-based client
	const validUrl = 'https://test-resolve.example.com/metadata'
	mockCtx.mockFetchResponses.set(validUrl, () =>
		Response.json(
			{
				client_id: validUrl,
				client_name: 'My MCP App',
				redirect_uris: ['https://test-resolve.example.com/callback'],
				grant_types: ['authorization_code'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const resolved = await resolveClient(validUrl)
	expect(resolved).not.toBeNull()
	expect(resolved!.id).toBe(validUrl)
	expect(resolved!.name).toBe('My MCP App')
	expect(resolved!.redirectUris).toEqual([
		'https://test-resolve.example.com/callback',
	])
	expect(resolved!.grantTypes).toEqual(['authorization_code'])
	expect(resolved!.isMetadataClient).toBe(true)

	clearMetadataCache()

	// Uses hostname as name when client_name not provided
	const noNameUrl = 'https://test-no-name.example.com/metadata'
	mockCtx.mockFetchResponses.set(noNameUrl, () =>
		Response.json(
			{
				client_id: noNameUrl,
				redirect_uris: ['https://test-no-name.example.com/callback'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const noNameResolved = await resolveClient(noNameUrl)
	expect(noNameResolved).not.toBeNull()
	expect(noNameResolved!.name).toBe('test-no-name.example.com')

	clearMetadataCache()

	// Defaults to authorization_code grant type when not specified
	const defaultGrantUrl = 'https://test-default-grant.example.com/metadata'
	mockCtx.mockFetchResponses.set(defaultGrantUrl, () =>
		Response.json(
			{
				client_id: defaultGrantUrl,
				redirect_uris: ['https://test-default-grant.example.com/callback'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const defaultGrantResolved = await resolveClient(defaultGrantUrl)
	expect(defaultGrantResolved).not.toBeNull()
	expect(defaultGrantResolved!.grantTypes).toEqual(['authorization_code'])

	clearMetadataCache()

	// Invalid URL client metadata returns null
	consoleError.mockImplementation(() => {})
	const invalidUrl = 'https://test-invalid-resolve.example.com/metadata'
	mockCtx.mockFetchResponses.set(
		invalidUrl,
		() => new Response('Not Found', { status: 404 }),
	)
	await expect(resolveClient(invalidUrl)).resolves.toBeNull()
})

test('URL-based client redirect URI and grant type validation', async () => {
	using mockCtx = setupMockFetch()

	// Redirect URI validation
	const redirectUrl = 'https://test-redirect-validation.example.com/metadata'
	mockCtx.mockFetchResponses.set(redirectUrl, () =>
		Response.json(
			{
				client_id: redirectUrl,
				redirect_uris: [
					'https://test-redirect-validation.example.com/callback',
					'https://test-redirect-validation.example.com/callback2',
				],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const redirectResolved = await resolveClient(redirectUrl)
	expect(redirectResolved).not.toBeNull()

	// Valid redirect URIs
	expect(
		isValidClientRedirectUri(
			redirectResolved!,
			'https://test-redirect-validation.example.com/callback',
		),
	).toBe(true)
	expect(
		isValidClientRedirectUri(
			redirectResolved!,
			'https://test-redirect-validation.example.com/callback2',
		),
	).toBe(true)

	// Invalid redirect URI
	expect(
		isValidClientRedirectUri(
			redirectResolved!,
			'https://evil.example.com/callback',
		),
	).toBe(false)

	clearMetadataCache()

	// Grant type validation
	const grantUrl = 'https://test-grant-validation.example.com/metadata'
	mockCtx.mockFetchResponses.set(grantUrl, () =>
		Response.json(
			{
				client_id: grantUrl,
				redirect_uris: ['https://test-grant-validation.example.com/callback'],
				grant_types: ['authorization_code', 'refresh_token'],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const grantResolved = await resolveClient(grantUrl)
	expect(grantResolved).not.toBeNull()

	expect(clientSupportsGrantType(grantResolved!, 'authorization_code')).toBe(
		true,
	)
	expect(clientSupportsGrantType(grantResolved!, 'refresh_token')).toBe(true)
	expect(clientSupportsGrantType(grantResolved!, 'client_credentials')).toBe(
		false,
	)

	clearMetadataCache()

	// Client without authorization_code grant fails validation
	const noAuthCodeUrl = 'https://test-no-auth-code.example.com/metadata'
	mockCtx.mockFetchResponses.set(noAuthCodeUrl, () =>
		Response.json(
			{
				client_id: noAuthCodeUrl,
				redirect_uris: ['https://test-no-auth-code.example.com/callback'],
				grant_types: ['client_credentials'], // No authorization_code
			},
			{ headers: { 'Content-Type': 'application/json' } },
		),
	)

	const noAuthCodeResolved = await resolveClient(noAuthCodeUrl)
	expect(noAuthCodeResolved).not.toBeNull()
	expect(
		clientSupportsGrantType(noAuthCodeResolved!, 'authorization_code'),
	).toBe(false)
	expect(
		clientSupportsGrantType(noAuthCodeResolved!, 'client_credentials'),
	).toBe(true)
})

test('DCR endpoint works (MCP 2025-11-25 compliance)', async () => {
	using ctx = await createTestServer()

	// Register a new client via DCR
	const registerResponse = await fetch(`${ctx.baseUrl}/oauth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: ['http://localhost:9999/callback'],
			client_name: 'DCR Test Client',
		}),
	})

	expect(registerResponse.status).toBe(201)

	const clientData = (await registerResponse.json()) as {
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
	expect(clientData.redirect_uris).toContain('http://localhost:9999/callback')
	expect(clientData.token_endpoint_auth_method).toBe('none')
	expect(clientData.grant_types).toContain('authorization_code')
	expect(clientData.response_types).toContain('code')
	expect(clientData.client_id_issued_at).toBeGreaterThan(0)
})
