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
 * Get an authorization code if it exists, is not expired, and has not been used.
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
 * Consume an authorization code (mark it as used).
 * Returns the code if successful, null if already used or not found.
 */
export function consumeAuthorizationCode(
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

	// Check if already used (single-use enforcement)
	if (authCode.usedAt !== null) {
		return null
	}

	// Mark as used
	db.query(sql`UPDATE authorization_codes SET used_at = ? WHERE code = ?;`).run(
		now,
		code,
	)

	return {
		...authCode,
		usedAt: now,
	}
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
