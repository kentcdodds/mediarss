import { and, gte, isNull, lt, type TableRow } from 'remix/data-table'
import { db } from '#app/db/index.ts'
import { toCamelCaseRow, type CamelCaseRow } from '#app/db/rows.ts'
import { oauthRefreshTokensTable } from '#app/db/schema.ts'
import { generateId, generateToken } from '#app/helpers/crypto.ts'

// Refresh tokens expire after 30 days of inactivity (sliding on each use)
const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60

/**
 * How long a just-rotated refresh token may be presented again without
 * revoking its family.
 *
 * Clients such as the MCP TypeScript SDK refresh with no single-flight lock.
 * Two callers can present the same token when an access token expires. Those
 * clients treat `invalid_grant` as "delete the stored refresh token", so
 * revoking the family on that overlap forces a manual login. Reuse inside
 * this window returns the family's current live refresh token. Reuse after
 * the window is still treated as theft and revokes the family, including
 * when the presented token's own expires_at has already passed.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 60

export type RefreshToken = CamelCaseRow<
	TableRow<typeof oauthRefreshTokensTable>
>

export type RefreshRedeemResult =
	| {
			status: 'rotated' | 'reused'
			token: RefreshToken
			grantedScope: string
	  }
	| {
			status: 'rejected'
			error: 'invalid_grant' | 'invalid_scope'
			description: string
			replay: boolean
	  }

const INVALID_GRANT = {
	status: 'rejected',
	error: 'invalid_grant',
	description: 'Refresh token is invalid, expired, or has already been used.',
	replay: false,
} as const satisfies RefreshRedeemResult

const WRONG_CLIENT = {
	status: 'rejected',
	error: 'invalid_grant',
	description: 'Refresh token was not issued to this client.',
	replay: false,
} as const satisfies RefreshRedeemResult

const INVALID_SCOPE = {
	status: 'rejected',
	error: 'invalid_scope',
	description: 'Requested scope exceeds the scope originally granted.',
	replay: false,
} as const satisfies RefreshRedeemResult

const refreshFamilyChains = new Map<string, Promise<void>>()

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
			replaced_by: null,
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
 * Rotate or, within the reuse grace window, return the family's live token.
 * A single-process lock per family keeps overlapping refreshes ordered.
 * Atomic updates still cover a second process sharing the database file.
 */
export async function redeemRefreshToken(params: {
	token: string
	clientId: string
	scope: string
}): Promise<RefreshRedeemResult> {
	const existing = await getRefreshToken(params.token)
	if (!existing) return INVALID_GRANT
	if (existing.clientId !== params.clientId) return WRONG_CLIENT
	return withRefreshFamilyLock(existing.familyId, () =>
		redeemRefreshTokenLocked(params),
	)
}

/**
 * Revoke every refresh token in a family (replay detection).
 */
export async function revokeRefreshTokenFamily(
	familyId: string,
): Promise<number> {
	// Stamp used_at outside the reuse grace window. A revocation is not a
	// rotation, and presenting the token we just killed must not mint a
	// replacement the way an interrupted rotation does.
	const revokedAt =
		Math.floor(Date.now() / 1000) - REFRESH_REUSE_GRACE_SECONDS - 1
	const result = await db.updateMany(
		oauthRefreshTokensTable,
		{ used_at: revokedAt },
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

async function redeemRefreshTokenLocked(params: {
	token: string
	clientId: string
	scope: string
}): Promise<RefreshRedeemResult> {
	const now = Math.floor(Date.now() / 1000)
	const presented = await getRefreshToken(params.token)
	if (!presented) return INVALID_GRANT
	if (presented.clientId !== params.clientId) return WRONG_CLIENT

	if (presented.usedAt === null) {
		if (presented.expiresAt < now) return INVALID_GRANT
		if (!requestedScopeIsAllowed(params.scope, presented.scope)) {
			return INVALID_SCOPE
		}
		const marked = await markRefreshTokenUsed(presented.token, now)
		if (!marked) {
			const raced = await getRefreshToken(presented.token)
			if (!raced || raced.usedAt === null) return INVALID_GRANT
			return redeemUsedRefreshToken(raced, params, now)
		}
		return issueRotatedRefreshToken(presented, params.scope)
	}

	return redeemUsedRefreshToken(presented, params, now)
}

async function redeemUsedRefreshToken(
	presented: RefreshToken,
	params: { scope: string },
	now: number,
): Promise<RefreshRedeemResult> {
	const withinGrace =
		presented.usedAt !== null &&
		now - presented.usedAt <= REFRESH_REUSE_GRACE_SECONDS

	if (!withinGrace) {
		await revokeRefreshTokenFamily(presented.familyId)
		return { ...INVALID_GRANT, replay: true }
	}

	const live = await findUsableFamilyToken(presented.familyId, now)
	if (live) {
		if (!requestedScopeIsAllowed(params.scope, live.scope)) {
			return INVALID_SCOPE
		}
		if (!presented.replacedBy) {
			await linkReplacement(presented.token, live.token)
		}
		return {
			status: 'reused',
			token: live,
			grantedScope: params.scope || live.scope,
		}
	}

	const descendants = await db.findMany(oauthRefreshTokensTable, {
		where: and(
			{ family_id: presented.familyId },
			gte('created_at', presented.createdAt),
		),
	})
	// Same-second parents point at this token via replaced_by. Anything else
	// in the family was issued after it (or instead of a missing successor).
	const hasDescendant = descendants.some(
		(row) =>
			row.token !== presented.token && row.replaced_by !== presented.token,
	)
	if (hasDescendant) return INVALID_GRANT

	// Consumed, but the successor insert never landed. Finish that rotation
	// instead of treating the retry as theft.
	if (!requestedScopeIsAllowed(params.scope, presented.scope)) {
		return INVALID_SCOPE
	}
	return issueRotatedRefreshToken(presented, params.scope, 'reused')
}

async function issueRotatedRefreshToken(
	presented: RefreshToken,
	requestedScope: string,
	status: 'rotated' | 'reused' = 'rotated',
): Promise<RefreshRedeemResult> {
	const grantedScope = requestedScope || presented.scope
	const rotated = await createRefreshToken({
		clientId: presented.clientId,
		scope: grantedScope,
		familyId: presented.familyId,
	})
	const linked = await linkReplacement(presented.token, rotated.token)
	if (linked) {
		return { status, token: rotated, grantedScope }
	}

	// Another worker published a successor first. Drop ours.
	await markRefreshTokenUsed(rotated.token, Math.floor(Date.now() / 1000))
	const live = await findUsableFamilyToken(
		presented.familyId,
		Math.floor(Date.now() / 1000),
	)
	if (!live) return INVALID_GRANT
	if (!requestedScopeIsAllowed(requestedScope, live.scope)) return INVALID_SCOPE
	return {
		status: 'reused',
		token: live,
		grantedScope: requestedScope || live.scope,
	}
}

async function findUsableFamilyToken(
	familyId: string,
	now: number,
): Promise<RefreshToken | null> {
	const rows = await db.findMany(oauthRefreshTokensTable, {
		where: and(
			{ family_id: familyId },
			isNull('used_at'),
			gte('expires_at', now),
		),
		orderBy: [['created_at', 'desc']],
		limit: 1,
	})
	const row = rows[0]
	return row ? toCamelCaseRow(row) : null
}

async function markRefreshTokenUsed(
	token: string,
	now: number,
): Promise<boolean> {
	const result = await db.updateMany(
		oauthRefreshTokensTable,
		{ used_at: now },
		{ where: and({ token }, isNull('used_at'), gte('expires_at', now)) },
	)
	return result.affectedRows > 0
}

async function linkReplacement(
	usedToken: string,
	successor: string,
): Promise<boolean> {
	const result = await db.updateMany(
		oauthRefreshTokensTable,
		{ replaced_by: successor },
		{ where: and({ token: usedToken }, isNull('replaced_by')) },
	)
	return result.affectedRows > 0
}

function requestedScopeIsAllowed(
	requestedScope: string,
	grantedScope: string,
): boolean {
	if (!requestedScope) return true
	const granted = new Set(grantedScope.split(' ').filter(Boolean))
	return requestedScope
		.split(' ')
		.filter(Boolean)
		.every((scope) => granted.has(scope))
}

function withRefreshFamilyLock<T>(
	familyId: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = refreshFamilyChains.get(familyId) ?? Promise.resolve()
	const run = previous.catch(() => undefined).then(task)
	const settled = run.then(
		() => undefined,
		() => undefined,
	)
	refreshFamilyChains.set(familyId, settled)
	void settled.finally(() => {
		if (refreshFamilyChains.get(familyId) === settled) {
			refreshFamilyChains.delete(familyId)
		}
	})
	return run
}
