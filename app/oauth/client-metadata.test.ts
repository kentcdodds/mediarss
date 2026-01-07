// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from 'bun:test'
import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import {
	clearKeyCache,
	clearMetadataCache,
	computeS256Challenge,
	createClient,
	deleteClient,
	generateCodeVerifier,
	getAudience,
	isUrlClientId,
	isValidClientRedirectUri,
	resolveClient,
} from './index.ts'

// Ensure migrations are run
migrate(db)

// Mock server for hosting client metadata documents
let mockMetadataServer: ReturnType<typeof Bun.serve>
const mockClientMetadata: Record<string, unknown> = {}

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

beforeAll(async () => {
	// Start mock metadata server
	mockMetadataServer = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url)
			const path = url.pathname

			// Check if we have mock metadata for this path
			const metadata = mockClientMetadata[path]
			if (metadata) {
				// Check if it's an error config
				if (
					typeof metadata === 'object' &&
					metadata !== null &&
					'__error' in metadata
				) {
					const errorConfig = metadata as {
						__error: { status: number; body: string }
					}
					return new Response(errorConfig.__error.body, {
						status: errorConfig.__error.status,
						headers: { 'Content-Type': 'text/plain' },
					})
				}

				return Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=300',
					},
				})
			}

			return new Response('Not Found', { status: 404 })
		},
	})
})

afterAll(() => {
	if (mockMetadataServer) {
		mockMetadataServer.stop()
	}
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
	// Clear mock metadata and caches between tests
	for (const key of Object.keys(mockClientMetadata)) {
		delete mockClientMetadata[key]
	}
	clearMetadataCache()
})

describe('isUrlClientId', () => {
	test('returns true for HTTPS URLs', () => {
		expect(isUrlClientId('https://example.com/client')).toBe(true)
		expect(isUrlClientId('https://client.example.com')).toBe(true)
		expect(isUrlClientId('https://example.com:8443/client')).toBe(true)
	})

	test('returns false for HTTP URLs', () => {
		// HTTP URLs should not be valid for metadata documents (security)
		expect(isUrlClientId('http://example.com/client')).toBe(false)
	})

	test('returns false for non-URL strings', () => {
		expect(isUrlClientId('mcp-client')).toBe(false)
		expect(isUrlClientId('my-app')).toBe(false)
		expect(isUrlClientId('')).toBe(false)
	})

	test('returns false for invalid URLs', () => {
		expect(isUrlClientId('not-a-url')).toBe(false)
		expect(isUrlClientId('ftp://example.com')).toBe(false)
	})
})

describe('resolveClient', () => {
	test('resolves static client by ID', async () => {
		const staticClient = createTestClient('Static Test ' + uniqueId(), [
			'http://localhost:3000/callback',
		])

		const resolved = await resolveClient(staticClient.id)
		expect(resolved).not.toBeNull()
		expect(resolved!.id).toBe(staticClient.id)
		expect(resolved!.name).toContain('Static Test')
		expect(resolved!.redirectUris).toEqual(['http://localhost:3000/callback'])
		expect(resolved!.isMetadataClient).toBe(false)
	})

	test('returns null for unknown static client', async () => {
		const resolved = await resolveClient('nonexistent-client-' + uniqueId())
		expect(resolved).toBeNull()
	})

	// Note: URL-based client resolution requires HTTPS which we can't easily mock
	// The tests below test the URL detection logic and static fallback
})

describe('isValidClientRedirectUri', () => {
	test('validates redirect URIs for static client', async () => {
		const staticClient = createTestClient('URI Test ' + uniqueId(), [
			'http://localhost:3000/callback',
			'http://localhost:8080/callback',
		])

		const resolved = await resolveClient(staticClient.id)
		expect(resolved).not.toBeNull()

		expect(
			isValidClientRedirectUri(resolved!, 'http://localhost:3000/callback'),
		).toBe(true)
		expect(
			isValidClientRedirectUri(resolved!, 'http://localhost:8080/callback'),
		).toBe(true)
		expect(
			isValidClientRedirectUri(resolved!, 'http://evil.com/callback'),
		).toBe(false)
	})
})

describe('OAuth full flow with static client', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string
	let testClient: { id: string; redirectUris: string[] }

	beforeAll(async () => {
		// Create test client
		testClient = createTestClient('Flow Test ' + uniqueId(), [
			'http://localhost:9999/callback',
		])

		// Import and start the router
		const { default: router } = await import('#app/router.tsx')

		server = Bun.serve({
			port: 0,
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
		clearKeyCache()
	})

	test('Server metadata endpoint returns correct data', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		expect(response.status).toBe(200)

		const metadata = (await response.json()) as {
			issuer: string
			authorization_endpoint: string
			token_endpoint: string
			jwks_uri: string
			response_types_supported: string[]
			grant_types_supported: string[]
			code_challenge_methods_supported: string[]
			token_endpoint_auth_methods_supported: string[]
			client_id_metadata_document_supported: boolean
		}

		expect(metadata.issuer).toBe(baseUrl)
		expect(metadata.authorization_endpoint).toBe(`${baseUrl}/admin/authorize`)
		expect(metadata.token_endpoint).toBe(`${baseUrl}/oauth/token`)
		expect(metadata.jwks_uri).toBe(`${baseUrl}/oauth/jwks`)
		expect(metadata.response_types_supported).toContain('code')
		expect(metadata.grant_types_supported).toContain('authorization_code')
		expect(metadata.code_challenge_methods_supported).toContain('S256')
		expect(metadata.client_id_metadata_document_supported).toBe(true)
	})

	test('Server metadata does not include registration endpoint', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		const metadata = (await response.json()) as Record<string, unknown>

		// Dynamic registration is optional per MCP 2025-11-25, and we don't implement it
		expect(metadata.registration_endpoint).toBeUndefined()
	})

	test('Full authorization code flow with static client', async () => {
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
		expect(tokenData.scope).toBe('read write')

		// Step 3: Verify token
		const jwksResponse = await fetch(`${baseUrl}/oauth/jwks`)
		const jwks = (await jwksResponse.json()) as { keys: jose.JWK[] }
		const publicKey = await jose.importJWK(jwks.keys[0]!, 'RS256')

		const { payload } = await jose.jwtVerify(
			tokenData.access_token,
			publicKey,
			{
				issuer: baseUrl,
				audience: getAudience(),
			},
		)

		expect(payload.iss).toBe(baseUrl)
		expect(payload.scope).toBe('read write')
	})

	test('Rejects unknown client ID', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: 'unknown-client-' + uniqueId(),
			redirect_uri: 'http://localhost:9999/callback',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const response = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
		)
		expect(response.status).toBe(400)

		const html = await response.text()
		expect(html).toContain('Invalid Client')
	})

	test('Rejects invalid redirect URI for static client', async () => {
		const verifier = generateCodeVerifier()
		const challenge = await computeS256Challenge(verifier)

		const authorizeParams = new URLSearchParams({
			response_type: 'code',
			client_id: testClient.id,
			redirect_uri: 'http://evil.com/callback', // Not registered
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const response = await fetch(
			`${baseUrl}/admin/authorize?${authorizeParams}`,
		)
		expect(response.status).toBe(400)

		const html = await response.text()
		expect(html).toContain('Invalid Redirect URI')
	})
})

describe('Client Metadata Document validation logic', () => {
	// These tests verify the validation logic without network calls

	test('URL client ID detection works correctly', () => {
		// Valid HTTPS URLs should be detected as URL client IDs
		expect(isUrlClientId('https://client.example.com/metadata.json')).toBe(true)
		expect(isUrlClientId('https://example.com')).toBe(true)

		// Non-HTTPS and non-URL strings should not be detected
		expect(isUrlClientId('http://insecure.example.com')).toBe(false)
		expect(isUrlClientId('simple-client-id')).toBe(false)
		expect(isUrlClientId('mcp-client')).toBe(false)
	})

	test('Static clients take precedence over URL lookups for non-URL IDs', async () => {
		const staticClient = createTestClient('Precedence Test ' + uniqueId(), [
			'http://localhost:5000/callback',
		])

		// Should resolve to static client, not try URL lookup
		const resolved = await resolveClient(staticClient.id)
		expect(resolved).not.toBeNull()
		expect(resolved!.isMetadataClient).toBe(false)
		expect(resolved!.id).toBe(staticClient.id)
	})
})

describe('Server metadata caching', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string

	beforeAll(async () => {
		const { default: router } = await import('#app/router.tsx')

		server = Bun.serve({
			port: 0,
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
	})

	test('Server metadata has appropriate cache headers', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)

		expect(response.status).toBe(200)
		const cacheControl = response.headers.get('Cache-Control')
		expect(cacheControl).toContain('max-age')
	})
})

describe('MCP 2025-11-25 spec compliance', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string

	beforeAll(async () => {
		const { default: router } = await import('#app/router.tsx')

		server = Bun.serve({
			port: 0,
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
	})

	test('Server metadata indicates client ID metadata document support', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		const metadata = (await response.json()) as {
			client_id_metadata_document_supported: boolean
		}

		// Per MCP 2025-11-25, servers MUST indicate support for client metadata documents
		expect(metadata.client_id_metadata_document_supported).toBe(true)
	})

	test('Dynamic client registration is optional (no registration endpoint)', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		const metadata = (await response.json()) as Record<string, unknown>

		// Per MCP 2025-11-25, dynamic registration is MAY (optional)
		// We don't implement it, so registration_endpoint should not be present
		expect(metadata.registration_endpoint).toBeUndefined()
	})

	test('PKCE with S256 is supported', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		const metadata = (await response.json()) as {
			code_challenge_methods_supported: string[]
		}

		expect(metadata.code_challenge_methods_supported).toContain('S256')
	})

	test('Authorization code grant is supported', async () => {
		const response = await fetch(
			`${baseUrl}/.well-known/oauth-authorization-server`,
		)
		const metadata = (await response.json()) as {
			grant_types_supported: string[]
			response_types_supported: string[]
		}

		expect(metadata.grant_types_supported).toContain('authorization_code')
		expect(metadata.response_types_supported).toContain('code')
	})
})
