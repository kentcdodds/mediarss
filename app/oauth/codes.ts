import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'
import { generateToken } from '#app/helpers/crypto.ts'

// Authorization codes expire after 10 minutes (RFC 6749 recommends max 10 minutes)
const CODE_EXPIRY_SECONDS = 600

export interface AuthorizationCode {
	code: string
	clientId: string
	redirectUri: string
	scope: string
	codeChallenge: string
	codeChallengeMethod: string
	expiresAt: number
	usedAt: number | null
	createdAt: number
}

interface CodeRow {
	code: string
	client_id: string
	redirect_uri: string
	scope: string
	code_challenge: string
	code_challenge_method: string
	expires_at: number
	used_at: number | null
	created_at: number
}

/**
 * Create a new authorization code.
 */
export function createAuthorizationCode(params: {
	clientId: string
	redirectUri: string
	scope: string
	codeChallenge: string
	codeChallengeMethod: string
}): AuthorizationCode {
	const code = generateToken()
	const now = Math.floor(Date.now() / 1000)
	const expiresAt = now + CODE_EXPIRY_SECONDS

	db.query(
		sql`INSERT INTO authorization_codes (code, client_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
	).run(
		code,
		params.clientId,
		params.redirectUri,
		params.scope,
		params.codeChallenge,
		params.codeChallengeMethod,
		expiresAt,
		now,
	)

	return {
		code,
		clientId: params.clientId,
		redirectUri: params.redirectUri,
		scope: params.scope,
		codeChallenge: params.codeChallenge,
		codeChallengeMethod: params.codeChallengeMethod,
		expiresAt,
		usedAt: null,
		createdAt: now,
	}
}

/**
 * Get an authorization code by its code string.
 * Returns the code regardless of expiry or usage status.
 */
export function getAuthorizationCode(code: string): AuthorizationCode | null {
	const row = db
		.query<CodeRow, [string]>(
			sql`SELECT * FROM authorization_codes WHERE code = ?;`,
		)
		.get(code)

	if (!row) {
		return null
	}

	return {
		code: row.code,
		clientId: row.client_id,
		redirectUri: row.redirect_uri,
		scope: row.scope,
		codeChallenge: row.code_challenge,
		codeChallengeMethod: row.code_challenge_method,
		expiresAt: row.expires_at,
		usedAt: row.used_at,
		createdAt: row.created_at,
	}
}

/**
 * Get an authorization code only if it is valid (exists, not expired, not used).
 * Does NOT consume the code - use this for validation before consuming.
 */
export function getValidAuthorizationCode(
	code: string,
): AuthorizationCode | null {
	const authCode = getAuthorizationCode(code)

	if (!authCode) {
		return null
	}

	const now = Math.floor(Date.now() / 1000)

	// Check if expired
	if (authCode.expiresAt < now) {
		return null
	}

	// Check if already used
	if (authCode.usedAt !== null) {
		return null
	}

	return authCode
}

/**
 * Atomically consume an authorization code (mark it as used).
 * Uses a conditional UPDATE to prevent TOCTOU race conditions.
 * Returns the code if successful, null if invalid, expired, or already used.
 */
export function consumeAuthorizationCode(
	code: string,
): AuthorizationCode | null {
	const now = Math.floor(Date.now() / 1000)

	// Atomically mark as used only if valid, not expired, and not already used
	// This prevents race conditions where two requests could both consume the same code
	const result = db
		.query(
			sql`UPDATE authorization_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at >= ?;`,
		)
		.run(now, code, now)

	// If no rows were affected, the code was invalid, expired, or already used
	if (result.changes === 0) {
		return null
	}

	// Fetch the updated row to return full details
	const authCode = getAuthorizationCode(code)
	if (!authCode) {
		return null
	}

	return authCode
}

/**
 * Delete expired authorization codes.
 * Should be called periodically to clean up.
 */
export function cleanupExpiredCodes(): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(sql`DELETE FROM authorization_codes WHERE expires_at < ?;`)
		.run(now)
	return result.changes
}

/**
 * Delete all authorization codes for a client.
 * Useful when revoking a client.
 */
export function deleteCodesForClient(clientId: string): number {
	const result = db
		.query(sql`DELETE FROM authorization_codes WHERE client_id = ?;`)
		.run(clientId)
	return result.changes
}
