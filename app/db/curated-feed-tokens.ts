import { generateToken } from '#app/helpers/crypto.ts'
import {
	curatedFeedTokensTable,
	curatedFeedsTable,
	dataTableDb,
} from './data-table.ts'
import { parseRow, parseRows } from './sql.ts'
import {
	type CuratedFeed,
	CuratedFeedSchema,
	type CuratedFeedToken,
	CuratedFeedTokenSchema,
} from './types.ts'

export type CreateCuratedFeedTokenData = {
	feedId: string
	label?: string
}

/**
 * Create a new token for a curated feed.
 */
export async function createCuratedFeedToken(
	data: CreateCuratedFeedTokenData,
): Promise<CuratedFeedToken> {
	const token = generateToken()
	const now = Math.floor(Date.now() / 1000)

	await dataTableDb.create(curatedFeedTokensTable, {
		token,
		feed_id: data.feedId,
		label: data.label ?? '',
		created_at: now,
		last_used_at: null,
		revoked_at: null,
	})

	const created = await getCuratedFeedToken(token)
	if (!created) {
		throw new Error(`Failed to create curated feed token "${token}"`)
	}
	return created
}

/**
 * Get a token by its value.
 */
export async function getCuratedFeedToken(
	token: string,
): Promise<CuratedFeedToken | undefined> {
	const row = await dataTableDb.findOne(curatedFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	return row ? parseRow(CuratedFeedTokenSchema, row) : undefined
}

/**
 * Get a curated feed by token.
 * This is the primary way to resolve a feed from a URL token.
 * Returns undefined if the token is invalid, revoked, or doesn't exist.
 */
export async function getCuratedFeedByToken(
	token: string,
): Promise<CuratedFeed | undefined> {
	const tokenRow = await dataTableDb.findOne(curatedFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	if (!tokenRow) return undefined

	const feedRow = await dataTableDb.find(curatedFeedsTable, tokenRow.feed_id)
	return feedRow ? parseRow(CuratedFeedSchema, feedRow) : undefined
}

/**
 * List all tokens for a curated feed.
 */
export async function listCuratedFeedTokens(
	feedId: string,
): Promise<Array<CuratedFeedToken>> {
	const rows = await dataTableDb.findMany(curatedFeedTokensTable, {
		where: { feed_id: feedId },
		orderBy: [['created_at', 'desc']],
	})
	return parseRows(CuratedFeedTokenSchema, rows)
}

/**
 * List active (non-revoked) tokens for a curated feed.
 */
export async function listActiveCuratedFeedTokens(
	feedId: string,
): Promise<Array<CuratedFeedToken>> {
	const rows = await dataTableDb.findMany(curatedFeedTokensTable, {
		where: { feed_id: feedId, revoked_at: null },
		orderBy: [['created_at', 'desc']],
	})
	return parseRows(CuratedFeedTokenSchema, rows)
}

/**
 * Revoke a token (soft delete).
 */
export async function revokeCuratedFeedToken(token: string): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000)
	const result = await dataTableDb.updateMany(
		curatedFeedTokensTable,
		{ revoked_at: now },
		{ where: { token, revoked_at: null } },
	)
	return result.affectedRows > 0
}

/**
 * Update the last_used_at timestamp for a token.
 * Call this when a token is used to access a feed.
 */
export async function touchCuratedFeedToken(token: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000)
	await dataTableDb.updateMany(
		curatedFeedTokensTable,
		{ last_used_at: now },
		{ where: { token } },
	)
}

/**
 * Update a token's label.
 */
export async function updateCuratedFeedTokenLabel(
	token: string,
	label: string,
): Promise<boolean> {
	const result = await dataTableDb.updateMany(
		curatedFeedTokensTable,
		{ label },
		{ where: { token } },
	)
	return result.affectedRows > 0
}

/**
 * Permanently delete a token.
 */
export async function deleteCuratedFeedToken(token: string): Promise<boolean> {
	return dataTableDb.delete(curatedFeedTokensTable, token)
}

/**
 * Revoke all tokens for a feed.
 */
export async function revokeAllCuratedFeedTokens(
	feedId: string,
): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await dataTableDb.updateMany(
		curatedFeedTokensTable,
		{ revoked_at: now },
		{ where: { feed_id: feedId, revoked_at: null } },
	)
	return result.affectedRows
}
