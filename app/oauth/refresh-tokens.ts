import { and, gte, isNull, lt, type TableRow } from 'remix/data-table'
import { db } from '#app/db/index.ts'
import { toCamelCaseRow, type CamelCaseRow } from '#app/db/rows.ts'
import { oauthRefreshTokensTable } from '#app/db/schema.ts'
import { generateId, generateToken } from '#app/helpers/crypto.ts'

// Refresh tokens expire after 30 days of inactivity (sliding on each use)
const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60

export type RefreshToken = CamelCaseRow<
	TableRow<typeof oauthRefreshTokensTable>
>

/**
 * Create a refresh token. Pass familyId to continue a rotated token family.
 */
export async function createRefreshToken(params: {
	clientId: string
	scope: string
	familyId?: string
}): Promise<RefreshToken> {
	const now = Math.floor(Date.now() / 1000)

	const row = await db.create(
		oauthRefreshTokensTable,
		{
			token: generateToken(),
			family_id: params.familyId ?? generateId(),
			client_id: params.clientId,
			scope: params.scope,
			expires_at: now + REFRESH_TOKEN_EXPIRY_SECONDS,
			used_at: null,
			created_at: now,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(row)
}

/**
 * Get a refresh token by its secret, regardless of expiry or usage.
 */
export async function getRefreshToken(
	token: string,
): Promise<RefreshToken | null> {
	const row = await db.find(oauthRefreshTokensTable, token)
	return row ? toCamelCaseRow(row) : null
}

/**
 * Atomically consume a refresh token and return it if it was still valid.
 * Reuse of an already-consumed token revokes the entire family.
 */
export async function consumeRefreshToken(
	token: string,
): Promise<RefreshToken | null> {
	const now = Math.floor(Date.now() / 1000)
	const existing = await getRefreshToken(token)

	if (!existing) {
		return null
	}

	if (existing.usedAt !== null) {
		await revokeRefreshTokenFamily(existing.familyId)
		return null
	}

	if (existing.expiresAt < now) {
		return null
	}

	const result = await db.updateMany(
		oauthRefreshTokensTable,
		{ used_at: now },
		{ where: and({ token }, isNull('used_at'), gte('expires_at', now)) },
	)

	if (result.affectedRows === 0) {
		const raced = await getRefreshToken(token)
		if (raced?.usedAt !== null) {
			await revokeRefreshTokenFamily(existing.familyId)
		}
		return null
	}

	return getRefreshToken(token)
}

/**
 * Revoke every refresh token in a family (replay detection).
 */
export async function revokeRefreshTokenFamily(
	familyId: string,
): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await db.updateMany(
		oauthRefreshTokensTable,
		{ used_at: now },
		{ where: and({ family_id: familyId }, isNull('used_at')) },
	)
	return result.affectedRows
}

/**
 * Delete all refresh tokens for a client.
 */
export async function deleteRefreshTokensForClient(
	clientId: string,
): Promise<number> {
	const result = await db.deleteMany(oauthRefreshTokensTable, {
		where: { client_id: clientId },
	})
	return result.affectedRows
}

/**
 * Delete expired refresh tokens.
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await db.deleteMany(oauthRefreshTokensTable, {
		where: lt('expires_at', now),
	})
	return result.affectedRows
}

/**
 * Rotate a consumed refresh token: issue a new token in the same family.
 */
export function rotateRefreshToken(
	consumed: RefreshToken,
): Promise<RefreshToken> {
	return createRefreshToken({
		clientId: consumed.clientId,
		scope: consumed.scope,
		familyId: consumed.familyId,
	})
}
