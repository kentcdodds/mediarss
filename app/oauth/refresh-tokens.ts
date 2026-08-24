import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'
import { generateId, generateToken } from '#app/helpers/crypto.ts'

// Refresh tokens expire after 30 days of inactivity (sliding on each use)
const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60

export interface RefreshToken {
	token: string
	familyId: string
	clientId: string
	scope: string
	expiresAt: number
	usedAt: number | null
	createdAt: number
}

interface RefreshTokenRow {
	token: string
	family_id: string
	client_id: string
	scope: string
	expires_at: number
	used_at: number | null
	created_at: number
}

function rowToRefreshToken(row: RefreshTokenRow): RefreshToken {
	return {
		token: row.token,
		familyId: row.family_id,
		clientId: row.client_id,
		scope: row.scope,
		expiresAt: row.expires_at,
		usedAt: row.used_at,
		createdAt: row.created_at,
	}
}

/**
 * Create a refresh token. Pass familyId to continue a rotated token family.
 */
export function createRefreshToken(params: {
	clientId: string
	scope: string
	familyId?: string
}): RefreshToken {
	const token = generateToken()
	const familyId = params.familyId ?? generateId()
	const now = Math.floor(Date.now() / 1000)
	const expiresAt = now + REFRESH_TOKEN_EXPIRY_SECONDS

	db.query(
		sql`INSERT INTO oauth_refresh_tokens (token, family_id, client_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?);`,
	).run(token, familyId, params.clientId, params.scope, expiresAt, now)

	return {
		token,
		familyId,
		clientId: params.clientId,
		scope: params.scope,
		expiresAt,
		usedAt: null,
		createdAt: now,
	}
}

/**
 * Get a refresh token by its secret, regardless of expiry or usage.
 */
export function getRefreshToken(token: string): RefreshToken | null {
	const row = db
		.query<RefreshTokenRow, [string]>(
			sql`SELECT * FROM oauth_refresh_tokens WHERE token = ?;`,
		)
		.get(token)

	if (!row) {
		return null
	}

	return rowToRefreshToken(row)
}

/**
 * Atomically consume a refresh token and return it if it was still valid.
 * Reuse of an already-consumed token revokes the entire family.
 */
export function consumeRefreshToken(token: string): RefreshToken | null {
	const now = Math.floor(Date.now() / 1000)
	const existing = getRefreshToken(token)

	if (!existing) {
		return null
	}

	if (existing.usedAt !== null) {
		revokeRefreshTokenFamily(existing.familyId)
		return null
	}

	if (existing.expiresAt < now) {
		return null
	}

	const result = db
		.query(
			sql`UPDATE oauth_refresh_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at >= ?;`,
		)
		.run(now, token, now)

	if (result.changes === 0) {
		const raced = getRefreshToken(token)
		if (raced?.usedAt !== null) {
			revokeRefreshTokenFamily(existing.familyId)
		}
		return null
	}

	return getRefreshToken(token)
}

/**
 * Revoke every refresh token in a family (replay detection).
 */
export function revokeRefreshTokenFamily(familyId: string): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(
			sql`UPDATE oauth_refresh_tokens SET used_at = COALESCE(used_at, ?) WHERE family_id = ?;`,
		)
		.run(now, familyId)
	return result.changes
}

/**
 * Delete all refresh tokens for a client.
 */
export function deleteRefreshTokensForClient(clientId: string): number {
	const result = db
		.query(sql`DELETE FROM oauth_refresh_tokens WHERE client_id = ?;`)
		.run(clientId)
	return result.changes
}

/**
 * Delete expired refresh tokens.
 */
export function cleanupExpiredRefreshTokens(): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(sql`DELETE FROM oauth_refresh_tokens WHERE expires_at < ?;`)
		.run(now)
	return result.changes
}

/**
 * Rotate a consumed refresh token: issue a new token in the same family.
 */
export function rotateRefreshToken(consumed: RefreshToken): RefreshToken {
	return createRefreshToken({
		clientId: consumed.clientId,
		scope: consumed.scope,
		familyId: consumed.familyId,
	})
}
