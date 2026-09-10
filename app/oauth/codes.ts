import { and, gte, isNull, lt, type TableRow } from 'remix/data-table'
import { db } from '#app/db/index.ts'
import { toCamelCaseRow, type CamelCaseRow } from '#app/db/rows.ts'
import { authorizationCodesTable } from '#app/db/schema.ts'
import { generateToken } from '#app/helpers/crypto.ts'

// Authorization codes expire after 10 minutes (RFC 6749 recommends max 10 minutes)
const CODE_EXPIRY_SECONDS = 600

export type AuthorizationCode = CamelCaseRow<
	TableRow<typeof authorizationCodesTable>
>

/**
 * Create a new authorization code.
 */
export async function createAuthorizationCode(params: {
	clientId: string
	redirectUri: string
	scope: string
	codeChallenge: string
	codeChallengeMethod: string
}): Promise<AuthorizationCode> {
	const now = Math.floor(Date.now() / 1000)

	const row = await db.create(
		authorizationCodesTable,
		{
			code: generateToken(),
			client_id: params.clientId,
			redirect_uri: params.redirectUri,
			scope: params.scope,
			code_challenge: params.codeChallenge,
			code_challenge_method: params.codeChallengeMethod,
			expires_at: now + CODE_EXPIRY_SECONDS,
			used_at: null,
			created_at: now,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(row)
}

/**
 * Get an authorization code by its code string.
 * Returns the code regardless of expiry or usage status.
 */
export async function getAuthorizationCode(
	code: string,
): Promise<AuthorizationCode | null> {
	const row = await db.find(authorizationCodesTable, code)
	return row ? toCamelCaseRow(row) : null
}

/**
 * Get an authorization code only if it is valid (exists, not expired, not used).
 * Does NOT consume the code - use this for validation before consuming.
 */
export async function getValidAuthorizationCode(
	code: string,
): Promise<AuthorizationCode | null> {
	const authCode = await getAuthorizationCode(code)
	if (!authCode) return null

	const now = Math.floor(Date.now() / 1000)
	if (authCode.expiresAt < now) return null
	if (authCode.usedAt !== null) return null

	return authCode
}

/**
 * Atomically consume an authorization code (mark it as used).
 * Uses a conditional UPDATE to prevent TOCTOU race conditions.
 * Returns the code if successful, null if invalid, expired, or already used.
 */
export async function consumeAuthorizationCode(
	code: string,
): Promise<AuthorizationCode | null> {
	const now = Math.floor(Date.now() / 1000)

	// Atomically mark as used only if valid, not expired, and not already used
	// This prevents race conditions where two requests could both consume the same code
	const result = await db.updateMany(
		authorizationCodesTable,
		{ used_at: now },
		{ where: and({ code }, isNull('used_at'), gte('expires_at', now)) },
	)
	if (result.affectedRows === 0) return null

	return getAuthorizationCode(code)
}

/**
 * Delete expired authorization codes.
 * Should be called periodically to clean up.
 */
export async function cleanupExpiredCodes(): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await db.deleteMany(authorizationCodesTable, {
		where: lt('expires_at', now),
	})
	return result.affectedRows
}

/**
 * Delete all authorization codes for a client.
 * Useful when revoking a client.
 */
export async function deleteCodesForClient(clientId: string): Promise<number> {
	const result = await db.deleteMany(authorizationCodesTable, {
		where: { client_id: clientId },
	})
	return result.affectedRows
}
