// Initialize environment before any imports that depend on it
import '#app/config/init-env.ts'

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from 'bun:test'
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

describe('clientSupportsGrantType', () => {
	test('returns true when grant type is in client grantTypes', async () => {
		const staticClient = createTestClient('Grant Test ' + uniqueId(), [
			'http://localhost:3000/callback',
		])

		const resolved = await resolveClient(staticClient.id)
		expect(resolved).not.toBeNull()

		// Static clients default to authorization_code grant type
		expect(clientSupportsGrantType(resolved!, 'authorization_code')).toBe(true)
	})

	test('returns false when grant type is not in client grantTypes', async () => {
		const staticClient = createTestClient('Grant Test 2 ' + uniqueId(), [
			'http://localhost:3000/callback',
		])

		const resolved = await resolveClient(staticClient.id)
		expect(resolved).not.toBeNull()

		// Static clients don't support client_credentials
		expect(clientSupportsGrantType(resolved!, 'client_credentials')).toBe(false)
		expect(clientSupportsGrantType(resolved!, 'refresh_token')).toBe(false)
	})

	test('validates against custom grant types array', () => {
		// Create a mock ResolvedClient with specific grant types
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
})

describe('OAuth full flow with static client', () => {
	let server: ReturnType<typeof Bun.serve>
	let baseUrl: string
	let testClient: { id: string; redirectUris: string[] }

	beforeAll(async () => {
		// Reset rate limiters to ensure clean state for integration tests
		resetRateLimiters()

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
		resetRateLimiters()
	})

	// Reset rate limiters before each test to prevent accumulation
	beforeEach(() => {
		resetRateLimiters()
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

// ============================================================================
// URL-based Client ID Metadata Document Tests
// ============================================================================
// These tests mock the fetch function to test HTTPS URL-based client metadata
// document fetching, validation, and caching without making actual network calls.

describe('URL-based Client ID Metadata Documents', () => {
	const originalFetch = globalThis.fetch
	let mockFetchResponses: Map<string, () => Response | Promise<Response>>

	beforeEach(() => {
		mockFetchResponses = new Map()

		// Mock global fetch for HTTPS URLs
		// Cast through unknown to satisfy TypeScript (Bun's fetch has additional properties)
		globalThis.fetch = mock(
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
		) as unknown as typeof fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
		clearMetadataCache()
		// Clean up test metadata from DB
		db.run(
			sql`DELETE FROM client_metadata_cache WHERE client_id LIKE 'https://test-%';`,
		)
	})

	describe('getClientMetadata() with valid documents', () => {
		test('fetches and returns valid metadata document', async () => {
			const clientIdUrl = 'https://test-valid-client.example.com/oauth/metadata'
			const validMetadata = {
				client_id: clientIdUrl,
				client_name: 'Test MCP Client',
				redirect_uris: ['https://test-valid-client.example.com/callback'],
				grant_types: ['authorization_code'],
				response_types: ['code'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(validMetadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=3600',
					},
				}),
			)

			const result = await getClientMetadata(clientIdUrl)

			expect(result).not.toBeNull()
			expect(result!.client_id).toBe(clientIdUrl)
			expect(result!.client_name).toBe('Test MCP Client')
			expect(result!.redirect_uris).toEqual([
				'https://test-valid-client.example.com/callback',
			])
			expect(result!.grant_types).toEqual(['authorization_code'])
		})

		test('handles metadata with multiple redirect URIs', async () => {
			const clientIdUrl = 'https://test-multi-redirect.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: [
					'https://app.example.com/callback',
					'https://staging.example.com/callback',
					'http://localhost:3000/callback',
				],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)

			expect(result).not.toBeNull()
			expect(result!.redirect_uris).toHaveLength(3)
			expect(result!.redirect_uris).toContain(
				'https://app.example.com/callback',
			)
			expect(result!.redirect_uris).toContain('http://localhost:3000/callback')
		})

		test('handles metadata with optional fields omitted', async () => {
			const clientIdUrl = 'https://test-minimal.example.com/metadata'
			const minimalMetadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-minimal.example.com/callback'],
				// client_name, grant_types, response_types all optional
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(minimalMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)

			expect(result).not.toBeNull()
			expect(result!.client_id).toBe(clientIdUrl)
			expect(result!.client_name).toBeUndefined()
			expect(result!.grant_types).toBeUndefined()
		})

		test('returns null for non-URL client IDs', async () => {
			const result = await getClientMetadata('simple-client-id')
			expect(result).toBeNull()
		})

		test('returns null for HTTP (non-HTTPS) URLs', async () => {
			const result = await getClientMetadata(
				'http://insecure.example.com/metadata',
			)
			expect(result).toBeNull()
		})
	})

	describe('Metadata validation errors', () => {
		test('rejects metadata when client_id does not match URL', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-mismatch.example.com/metadata'
			const badMetadata = {
				client_id: 'https://different-domain.example.com/metadata', // Mismatch!
				redirect_uris: ['https://test-mismatch.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull() // Should fail validation
		})

		test('rejects metadata with empty redirect_uris array', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-empty-redirects.example.com/metadata'
			const badMetadata = {
				client_id: clientIdUrl,
				redirect_uris: [], // Empty array not allowed
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('rejects metadata with missing redirect_uris', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-missing-redirects.example.com/metadata'
			const badMetadata = {
				client_id: clientIdUrl,
				// redirect_uris is required but missing
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('rejects metadata with invalid redirect URI format', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-invalid-uri.example.com/metadata'
			const badMetadata = {
				client_id: clientIdUrl,
				redirect_uris: ['not-a-valid-url'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('rejects metadata with non-string redirect URI', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-wrong-type.example.com/metadata'
			const badMetadata = {
				client_id: clientIdUrl,
				redirect_uris: [12345], // Should be string
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('rejects metadata with invalid grant_types type', async () => {
			// Suppress expected console.error from validation failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-invalid-grants.example.com/metadata'
			const badMetadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-invalid-grants.example.com/callback'],
				grant_types: 'authorization_code', // Should be array
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(badMetadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})
	})

	describe('Fetch error handling', () => {
		test('handles 404 response', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-404.example.com/metadata'

			mockFetchResponses.set(
				clientIdUrl,
				() => new Response('Not Found', { status: 404 }),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('handles 500 server error', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-500.example.com/metadata'

			mockFetchResponses.set(
				clientIdUrl,
				() => new Response('Internal Server Error', { status: 500 }),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('handles non-JSON content type', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-wrong-content.example.com/metadata'

			mockFetchResponses.set(
				clientIdUrl,
				() =>
					new Response('<html>Not JSON</html>', {
						status: 200,
						headers: { 'Content-Type': 'text/html' },
					}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('handles invalid JSON response', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-bad-json.example.com/metadata'

			mockFetchResponses.set(
				clientIdUrl,
				() =>
					new Response('{ invalid json }', {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			)

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})

		test('handles network errors', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-network-error.example.com/metadata'

			mockFetchResponses.set(clientIdUrl, () => {
				throw new Error('Network error')
			})

			const result = await getClientMetadata(clientIdUrl)
			expect(result).toBeNull()
		})
	})

	describe('Cache behavior', () => {
		test('caches metadata in memory on successful fetch', async () => {
			const clientIdUrl = 'https://test-cache-memory.example.com/metadata'
			let fetchCount = 0
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-cache-memory.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () => {
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

			// Second call - should use cache
			const result2 = await getClientMetadata(clientIdUrl)
			expect(result2).not.toBeNull()
			expect(result2!.client_id).toBe(clientIdUrl)
			expect(fetchCount).toBe(1) // No additional fetch
		})

		test('caches metadata in database on successful fetch', async () => {
			const clientIdUrl = 'https://test-cache-db.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-cache-db.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=3600',
					},
				}),
			)

			await getClientMetadata(clientIdUrl)

			// Check database cache
			const row = db
				.query<{ client_id: string; metadata_json: string }, [string]>(
					sql`SELECT * FROM client_metadata_cache WHERE client_id = ?;`,
				)
				.get(clientIdUrl)

			expect(row).not.toBeNull()
			expect(row!.client_id).toBe(clientIdUrl)

			const cachedMetadata = JSON.parse(row!.metadata_json)
			expect(cachedMetadata.client_id).toBe(clientIdUrl)
		})

		test('retrieves from database cache after memory cache cleared', async () => {
			const clientIdUrl = 'https://test-cache-fallback.example.com/metadata'
			let fetchCount = 0
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-cache-fallback.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () => {
				fetchCount++
				return Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=3600',
					},
				})
			})

			// Fetch and cache
			await getClientMetadata(clientIdUrl)
			expect(fetchCount).toBe(1)

			// Clear only memory cache
			clearMetadataCache()

			// Should retrieve from DB cache, not fetch again
			const result = await getClientMetadata(clientIdUrl)
			expect(result).not.toBeNull()
			expect(result!.client_id).toBe(clientIdUrl)
			expect(fetchCount).toBe(1) // Still no additional fetch
		})

		test('respects Cache-Control max-age header', async () => {
			const clientIdUrl = 'https://test-cache-ttl.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-cache-ttl.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=600', // 10 minutes
					},
				}),
			)

			await getClientMetadata(clientIdUrl)

			// Check DB cache expiration
			const row = db
				.query<{ expires_at: number; cached_at: number }, [string]>(
					sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
				)
				.get(clientIdUrl)

			expect(row).not.toBeNull()
			const duration = row!.expires_at - row!.cached_at
			expect(duration).toBe(600) // Should match max-age
		})

		test('enforces minimum cache duration', async () => {
			const clientIdUrl = 'https://test-min-cache.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-min-cache.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=60', // Only 1 minute
					},
				}),
			)

			await getClientMetadata(clientIdUrl)

			const row = db
				.query<{ expires_at: number; cached_at: number }, [string]>(
					sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
				)
				.get(clientIdUrl)

			expect(row).not.toBeNull()
			const duration = row!.expires_at - row!.cached_at
			expect(duration).toBe(300) // Should be enforced minimum (5 minutes)
		})

		test('enforces maximum cache duration', async () => {
			const clientIdUrl = 'https://test-max-cache.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-max-cache.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=999999', // Very long
					},
				}),
			)

			await getClientMetadata(clientIdUrl)

			const row = db
				.query<{ expires_at: number; cached_at: number }, [string]>(
					sql`SELECT expires_at, cached_at FROM client_metadata_cache WHERE client_id = ?;`,
				)
				.get(clientIdUrl)

			expect(row).not.toBeNull()
			const duration = row!.expires_at - row!.cached_at
			expect(duration).toBe(86400) // Should be enforced maximum (24 hours)
		})
	})

	describe('resolveClient() with URL-based clients', () => {
		test('resolves URL-based client from metadata document', async () => {
			const clientIdUrl = 'https://test-resolve.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				client_name: 'My MCP App',
				redirect_uris: ['https://test-resolve.example.com/callback'],
				grant_types: ['authorization_code'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)

			expect(resolved).not.toBeNull()
			expect(resolved!.id).toBe(clientIdUrl)
			expect(resolved!.name).toBe('My MCP App')
			expect(resolved!.redirectUris).toEqual([
				'https://test-resolve.example.com/callback',
			])
			expect(resolved!.grantTypes).toEqual(['authorization_code'])
			expect(resolved!.isMetadataClient).toBe(true)
		})

		test('uses hostname as name when client_name not provided', async () => {
			const clientIdUrl = 'https://test-no-name.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-no-name.example.com/callback'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)

			expect(resolved).not.toBeNull()
			expect(resolved!.name).toBe('test-no-name.example.com')
		})

		test('defaults to authorization_code grant type when not specified', async () => {
			const clientIdUrl = 'https://test-default-grant.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-default-grant.example.com/callback'],
				// grant_types not specified
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)

			expect(resolved).not.toBeNull()
			expect(resolved!.grantTypes).toEqual(['authorization_code'])
		})

		test('returns null for invalid URL client metadata', async () => {
			// Suppress expected console.error from fetch failure
			consoleError.mockImplementation(() => {})

			const clientIdUrl = 'https://test-invalid-resolve.example.com/metadata'

			mockFetchResponses.set(
				clientIdUrl,
				() => new Response('Not Found', { status: 404 }),
			)

			const resolved = await resolveClient(clientIdUrl)
			expect(resolved).toBeNull()
		})

		test('redirect URI validation works for URL-based clients', async () => {
			const clientIdUrl =
				'https://test-redirect-validation.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: [
					'https://test-redirect-validation.example.com/callback',
					'https://test-redirect-validation.example.com/callback2',
				],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)
			expect(resolved).not.toBeNull()

			// Valid redirect URIs
			expect(
				isValidClientRedirectUri(
					resolved!,
					'https://test-redirect-validation.example.com/callback',
				),
			).toBe(true)
			expect(
				isValidClientRedirectUri(
					resolved!,
					'https://test-redirect-validation.example.com/callback2',
				),
			).toBe(true)

			// Invalid redirect URI
			expect(
				isValidClientRedirectUri(
					resolved!,
					'https://evil.example.com/callback',
				),
			).toBe(false)
		})

		test('grant type validation works for URL-based clients', async () => {
			const clientIdUrl = 'https://test-grant-validation.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-grant-validation.example.com/callback'],
				grant_types: ['authorization_code', 'refresh_token'],
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)
			expect(resolved).not.toBeNull()

			expect(clientSupportsGrantType(resolved!, 'authorization_code')).toBe(
				true,
			)
			expect(clientSupportsGrantType(resolved!, 'refresh_token')).toBe(true)
			expect(clientSupportsGrantType(resolved!, 'client_credentials')).toBe(
				false,
			)
		})

		test('client without authorization_code grant fails validation', async () => {
			const clientIdUrl = 'https://test-no-auth-code.example.com/metadata'
			const metadata = {
				client_id: clientIdUrl,
				redirect_uris: ['https://test-no-auth-code.example.com/callback'],
				grant_types: ['client_credentials'], // No authorization_code
			}

			mockFetchResponses.set(clientIdUrl, () =>
				Response.json(metadata, {
					headers: { 'Content-Type': 'application/json' },
				}),
			)

			const resolved = await resolveClient(clientIdUrl)
			expect(resolved).not.toBeNull()

			// Should fail authorization_code validation
			expect(clientSupportsGrantType(resolved!, 'authorization_code')).toBe(
				false,
			)
			expect(clientSupportsGrantType(resolved!, 'client_credentials')).toBe(
				true,
			)
		})
	})
})
