import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'

/**
 * Client ID Metadata Document support per MCP 2025-11-25 spec.
 * When a client_id is an HTTPS URL, the authorization server fetches
 * metadata from that URL to validate the client.
 */

/**
 * Client metadata as defined in RFC 7591 / MCP spec.
 * The client hosts this JSON document at their client_id URL.
 */
export interface ClientMetadataDocument {
	client_id: string
	client_name?: string
	redirect_uris: string[]
	grant_types?: string[]
	response_types?: string[]
	token_endpoint_auth_method?: string
	scope?: string
}

/**
 * Resolved client info from either static registration or metadata document.
 */
export interface ResolvedClient {
	id: string
	name: string
	redirectUris: string[]
	grantTypes: string[]
	isMetadataClient: boolean
}

interface CachedMetadataRow {
	client_id: string
	metadata_json: string
	cached_at: number
	expires_at: number
}

// Default cache duration: 1 hour (if no cache headers)
const DEFAULT_CACHE_DURATION_SECONDS = 3600

// Minimum cache duration: 5 minutes (to prevent DoS via rapid refetches)
const MIN_CACHE_DURATION_SECONDS = 300

// Maximum cache duration: 24 hours (even if server says longer)
const MAX_CACHE_DURATION_SECONDS = 86400

// In-memory cache for fast lookups
const metadataCache = new Map<
	string,
	{ metadata: ClientMetadataDocument; expiresAt: number }
>()

/**
 * Check if a client_id is a URL (indicating a metadata document client).
 */
export function isUrlClientId(clientId: string): boolean {
	if (!clientId) return false

	try {
		const url = new URL(clientId)
		// Per MCP spec, only HTTPS URLs are valid for client metadata documents
		return url.protocol === 'https:'
	} catch {
		return false
	}
}

/**
 * Parse cache duration from HTTP response headers.
 * Respects Cache-Control max-age and Expires headers.
 */
function parseCacheDuration(response: Response): number {
	const cacheControl = response.headers.get('Cache-Control')

	if (cacheControl) {
		// Check for no-store or no-cache
		if (
			cacheControl.includes('no-store') ||
			cacheControl.includes('no-cache')
		) {
			return MIN_CACHE_DURATION_SECONDS
		}

		// Extract max-age
		const maxAgeMatch = /max-age=(\d+)/.exec(cacheControl)
		if (maxAgeMatch) {
			const maxAge = parseInt(maxAgeMatch[1]!, 10)
			return Math.max(
				MIN_CACHE_DURATION_SECONDS,
				Math.min(MAX_CACHE_DURATION_SECONDS, maxAge),
			)
		}
	}

	// Check Expires header
	const expires = response.headers.get('Expires')
	if (expires) {
		const expiresDate = new Date(expires).getTime()
		const now = Date.now()
		if (expiresDate > now) {
			const seconds = Math.floor((expiresDate - now) / 1000)
			return Math.max(
				MIN_CACHE_DURATION_SECONDS,
				Math.min(MAX_CACHE_DURATION_SECONDS, seconds),
			)
		}
	}

	return DEFAULT_CACHE_DURATION_SECONDS
}

/**
 * Validate the structure of a client metadata document.
 */
function validateMetadataDocument(
	clientIdUrl: string,
	data: unknown,
): ClientMetadataDocument {
	if (typeof data !== 'object' || data === null) {
		throw new Error('Metadata document must be a JSON object')
	}

	const doc = data as Record<string, unknown>

	// client_id MUST match the URL exactly
	if (doc.client_id !== clientIdUrl) {
		throw new Error(
			`client_id in metadata (${doc.client_id}) must match the URL (${clientIdUrl})`,
		)
	}

	// redirect_uris is required and must be an array of strings
	if (!Array.isArray(doc.redirect_uris)) {
		throw new Error('redirect_uris must be an array')
	}

	if (doc.redirect_uris.length === 0) {
		throw new Error('redirect_uris must not be empty')
	}

	for (const uri of doc.redirect_uris) {
		if (typeof uri !== 'string') {
			throw new Error('All redirect_uris must be strings')
		}
		// Validate URI format
		try {
			new URL(uri)
		} catch {
			throw new Error(`Invalid redirect URI: ${uri}`)
		}
	}

	// Validate optional fields
	if (doc.client_name !== undefined && typeof doc.client_name !== 'string') {
		throw new Error('client_name must be a string')
	}

	if (doc.grant_types !== undefined) {
		if (!Array.isArray(doc.grant_types)) {
			throw new Error('grant_types must be an array')
		}
		for (const gt of doc.grant_types) {
			if (typeof gt !== 'string') {
				throw new Error('All grant_types must be strings')
			}
		}
	}

	if (doc.response_types !== undefined) {
		if (!Array.isArray(doc.response_types)) {
			throw new Error('response_types must be an array')
		}
		for (const rt of doc.response_types) {
			if (typeof rt !== 'string') {
				throw new Error('All response_types must be strings')
			}
		}
	}

	return {
		client_id: doc.client_id as string,
		client_name: doc.client_name as string | undefined,
		redirect_uris: doc.redirect_uris as string[],
		grant_types: doc.grant_types as string[] | undefined,
		response_types: doc.response_types as string[] | undefined,
		token_endpoint_auth_method: doc.token_endpoint_auth_method as
			| string
			| undefined,
		scope: doc.scope as string | undefined,
	}
}

/**
 * Fetch and validate a client metadata document from a URL.
 */
async function fetchMetadataDocument(
	clientIdUrl: string,
): Promise<{ metadata: ClientMetadataDocument; cacheDuration: number }> {
	let response: Response

	try {
		response = await fetch(clientIdUrl, {
			headers: {
				Accept: 'application/json',
			},
			// Timeout after 10 seconds
			signal: AbortSignal.timeout(10000),
		})
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Timeout fetching client metadata from ${clientIdUrl}`)
		}
		throw new Error(
			`Failed to fetch client metadata from ${clientIdUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
		)
	}

	if (!response.ok) {
		throw new Error(
			`Client metadata endpoint returned ${response.status}: ${clientIdUrl}`,
		)
	}

	const contentType = response.headers.get('Content-Type')
	if (!contentType?.includes('application/json')) {
		throw new Error(
			`Client metadata endpoint must return application/json, got: ${contentType}`,
		)
	}

	let data: unknown
	try {
		data = await response.json()
	} catch {
		throw new Error('Client metadata document is not valid JSON')
	}

	const metadata = validateMetadataDocument(clientIdUrl, data)
	const cacheDuration = parseCacheDuration(response)

	return { metadata, cacheDuration }
}

/**
 * Get cached metadata from database.
 */
function getCachedMetadataFromDb(
	clientId: string,
): ClientMetadataDocument | null {
	const now = Math.floor(Date.now() / 1000)

	const row = db
		.query<CachedMetadataRow, [string, number]>(
			sql`SELECT * FROM client_metadata_cache WHERE client_id = ? AND expires_at > ?;`,
		)
		.get(clientId, now)

	if (!row) {
		return null
	}

	try {
		return JSON.parse(row.metadata_json) as ClientMetadataDocument
	} catch {
		console.error('Failed to parse cached metadata:', row.metadata_json)
		return null
	}
}

/**
 * Save metadata to database cache.
 */
function saveMetadataToDb(
	clientId: string,
	metadata: ClientMetadataDocument,
	cacheDuration: number,
): void {
	const now = Math.floor(Date.now() / 1000)
	const expiresAt = now + cacheDuration

	db.query(
		sql`INSERT OR REPLACE INTO client_metadata_cache (client_id, metadata_json, cached_at, expires_at) VALUES (?, ?, ?, ?);`,
	).run(clientId, JSON.stringify(metadata), now, expiresAt)
}

/**
 * Get client metadata for a URL-based client_id.
 * Uses in-memory cache, then database cache, then fetches fresh.
 */
export async function getClientMetadata(
	clientIdUrl: string,
): Promise<ClientMetadataDocument | null> {
	if (!isUrlClientId(clientIdUrl)) {
		return null
	}

	const now = Date.now()

	// Check in-memory cache first
	const cached = metadataCache.get(clientIdUrl)
	if (cached && cached.expiresAt > now) {
		return cached.metadata
	}

	// Check database cache
	const dbCached = getCachedMetadataFromDb(clientIdUrl)
	if (dbCached) {
		// Store in memory cache too
		const expiresAt = now + DEFAULT_CACHE_DURATION_SECONDS * 1000
		metadataCache.set(clientIdUrl, { metadata: dbCached, expiresAt })
		return dbCached
	}

	// Fetch fresh metadata
	try {
		const { metadata, cacheDuration } = await fetchMetadataDocument(clientIdUrl)

		// Save to both caches
		saveMetadataToDb(clientIdUrl, metadata, cacheDuration)
		metadataCache.set(clientIdUrl, {
			metadata,
			expiresAt: now + cacheDuration * 1000,
		})

		return metadata
	} catch (error) {
		console.error('Failed to fetch client metadata:', error)
		return null
	}
}

/**
 * Resolve a client by ID, supporting both static clients and URL-based metadata documents.
 */
export async function resolveClient(
	clientId: string,
): Promise<ResolvedClient | null> {
	// First check if it's a URL-based client
	if (isUrlClientId(clientId)) {
		const metadata = await getClientMetadata(clientId)
		if (!metadata) {
			return null
		}

		return {
			id: metadata.client_id,
			name: metadata.client_name ?? new URL(clientId).hostname,
			redirectUris: metadata.redirect_uris,
			grantTypes: metadata.grant_types ?? ['authorization_code'],
			isMetadataClient: true,
		}
	}

	// Fall back to static client lookup
	const { getClient } = await import('./clients.ts')
	const staticClient = getClient(clientId)

	if (!staticClient) {
		return null
	}

	return {
		id: staticClient.id,
		name: staticClient.name,
		redirectUris: staticClient.redirectUris,
		grantTypes: ['authorization_code'], // Static clients only support auth code for now
		isMetadataClient: false,
	}
}

/**
 * Validate a redirect URI against a resolved client's allowed URIs.
 */
export function isValidClientRedirectUri(
	client: ResolvedClient,
	redirectUri: string,
): boolean {
	return client.redirectUris.includes(redirectUri)
}

/**
 * Clear the in-memory metadata cache.
 * Useful for testing.
 */
export function clearMetadataCache(): void {
	metadataCache.clear()
}

/**
 * Clean up expired metadata from database cache.
 */
export function cleanupExpiredMetadata(): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(sql`DELETE FROM client_metadata_cache WHERE expires_at < ?;`)
		.run(now)
	return result.changes
}
