import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'
import { generateId } from '#app/helpers/crypto.ts'

export interface OAuthClient {
	id: string
	name: string
	redirectUris: string[]
	createdAt: number
}

interface ClientRow {
	id: string
	name: string
	redirect_uris: string
	created_at: number
}

/**
 * Safely parse redirect URIs from JSON.
 * Falls back to empty array if parsing fails.
 */
function parseRedirectUris(json: string): string[] {
	try {
		const parsed = JSON.parse(json)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		console.error('Failed to parse redirect_uris:', json)
		return []
	}
}

/**
 * Get an OAuth client by ID.
 */
export function getClient(clientId: string): OAuthClient | null {
	const row = db
		.query<ClientRow, [string]>(sql`SELECT * FROM oauth_clients WHERE id = ?;`)
		.get(clientId)

	if (!row) {
		return null
	}

	return {
		id: row.id,
		name: row.name,
		redirectUris: parseRedirectUris(row.redirect_uris),
		createdAt: row.created_at,
	}
}

/**
 * Check if a redirect URI is valid for a given client.
 */
export function isValidRedirectUri(
	client: OAuthClient,
	redirectUri: string,
): boolean {
	return client.redirectUris.includes(redirectUri)
}

/**
 * Create a new OAuth client.
 */
export function createClient(
	name: string,
	redirectUris: string[],
): OAuthClient {
	const id = generateId()
	const createdAt = Math.floor(Date.now() / 1000)

	db.query(
		sql`INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?);`,
	).run(id, name, JSON.stringify(redirectUris), createdAt)

	return {
		id,
		name,
		redirectUris,
		createdAt,
	}
}

/**
 * Delete an OAuth client.
 */
export function deleteClient(clientId: string): boolean {
	const result = db
		.query(sql`DELETE FROM oauth_clients WHERE id = ?;`)
		.run(clientId)
	return result.changes > 0
}

/**
 * List all OAuth clients.
 */
export function listClients(): OAuthClient[] {
	const rows = db
		.query<ClientRow, []>(
			sql`SELECT * FROM oauth_clients ORDER BY created_at DESC;`,
		)
		.all()

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		redirectUris: parseRedirectUris(row.redirect_uris),
		createdAt: row.created_at,
	}))
}

/**
 * Ensure a default client exists for MCP.
 * This is called during application startup.
 */
export function ensureDefaultClient(): OAuthClient {
	const defaultClientId = 'mcp-client'
	let client = getClient(defaultClientId)

	if (!client) {
		const createdAt = Math.floor(Date.now() / 1000)
		// Default MCP client accepts localhost redirects for development
		db.query(
			sql`INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?);`,
		).run(
			defaultClientId,
			'MCP Client',
			JSON.stringify([
				'http://localhost:3000/callback',
				'http://localhost:8080/callback',
				'http://127.0.0.1:3000/callback',
				'http://127.0.0.1:8080/callback',
			]),
			createdAt,
		)

		client = {
			id: defaultClientId,
			name: 'MCP Client',
			redirectUris: [
				'http://localhost:3000/callback',
				'http://localhost:8080/callback',
				'http://127.0.0.1:3000/callback',
				'http://127.0.0.1:8080/callback',
			],
			createdAt,
		}
	}

	return client
}
