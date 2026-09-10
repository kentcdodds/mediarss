import { type TableRow } from 'remix/data-table'
import { db } from '#app/db/index.ts'
import { oauthClientsTable } from '#app/db/schema.ts'
import { generateId } from '#app/helpers/crypto.ts'
import { deleteCodesForClient } from './codes.ts'
import { deleteRefreshTokensForClient } from './refresh-tokens.ts'

export interface OAuthClient {
	id: string
	name: string
	redirectUris: string[]
	createdAt: number
}

const DEFAULT_CLIENT_ID = 'mcp-client'
// Default MCP client accepts localhost redirects for development
const DEFAULT_CLIENT_REDIRECT_URIS = [
	'http://localhost:3000/callback',
	'http://localhost:8080/callback',
	'http://127.0.0.1:3000/callback',
	'http://127.0.0.1:8080/callback',
]

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

function toClient(row: TableRow<typeof oauthClientsTable>): OAuthClient {
	return {
		id: row.id,
		name: row.name,
		redirectUris: parseRedirectUris(row.redirect_uris),
		createdAt: row.created_at,
	}
}

/**
 * Get an OAuth client by ID.
 */
export async function getClient(clientId: string): Promise<OAuthClient | null> {
	const row = await db.find(oauthClientsTable, clientId)
	return row ? toClient(row) : null
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

async function insertClient(
	id: string,
	name: string,
	redirectUris: string[],
): Promise<OAuthClient> {
	const createdAt = Math.floor(Date.now() / 1000)
	await db.create(oauthClientsTable, {
		id,
		name,
		redirect_uris: JSON.stringify(redirectUris),
		created_at: createdAt,
	})
	return { id, name, redirectUris, createdAt }
}

/**
 * Create a new OAuth client.
 */
export function createClient(
	name: string,
	redirectUris: string[],
): Promise<OAuthClient> {
	return insertClient(generateId(), name, redirectUris)
}

/**
 * Delete an OAuth client.
 */
export async function deleteClient(clientId: string): Promise<boolean> {
	await deleteCodesForClient(clientId)
	await deleteRefreshTokensForClient(clientId)
	return db.delete(oauthClientsTable, clientId)
}

/**
 * List all OAuth clients.
 */
export async function listClients(): Promise<OAuthClient[]> {
	const rows = await db.findMany(oauthClientsTable, {
		orderBy: [['created_at', 'desc']],
	})
	return rows.map(toClient)
}

/**
 * Ensure a default client exists for MCP.
 * This is called during application startup.
 */
export async function ensureDefaultClient(): Promise<OAuthClient> {
	const client = await getClient(DEFAULT_CLIENT_ID)
	if (client) return client
	return insertClient(
		DEFAULT_CLIENT_ID,
		'MCP Client',
		DEFAULT_CLIENT_REDIRECT_URIS,
	)
}
