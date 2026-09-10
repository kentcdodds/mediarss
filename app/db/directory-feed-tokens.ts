import { generateToken } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { toCamelCaseRow, toCamelCaseRows } from './rows.ts'
import { directoryFeedTokensTable, directoryFeedsTable } from './schema.ts'
import { type DirectoryFeed, type DirectoryFeedToken } from './types.ts'

export type CreateDirectoryFeedTokenData = {
	feedId: string
	label?: string
}

/**
 * Create a new token for a directory feed.
 */
export async function createDirectoryFeedToken(
	data: CreateDirectoryFeedTokenData,
): Promise<DirectoryFeedToken> {
	const token = generateToken()
	const now = Math.floor(Date.now() / 1000)

	const created = await db.create(
		directoryFeedTokensTable,
		{
			token,
			feed_id: data.feedId,
			label: data.label ?? '',
			created_at: now,
			last_used_at: null,
			revoked_at: null,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(created)
}

/**
 * Get a token by its value.
 */
export async function getDirectoryFeedToken(
	token: string,
): Promise<DirectoryFeedToken | undefined> {
	const row = await db.findOne(directoryFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	return row ? toCamelCaseRow(row) : undefined
}

/**
 * Get a directory feed by token.
 * This is the primary way to resolve a feed from a URL token.
 * Returns undefined if the token is invalid, revoked, or doesn't exist.
 */
export async function getDirectoryFeedByToken(
	token: string,
): Promise<DirectoryFeed | undefined> {
	const tokenRow = await db.findOne(directoryFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	if (!tokenRow) return undefined

	const feedRow = await db.find(directoryFeedsTable, tokenRow.feed_id)
	return feedRow ? toCamelCaseRow(feedRow) : undefined
}

/**
 * List all tokens for a directory feed.
 */
export async function listDirectoryFeedTokens(
	feedId: string,
): Promise<Array<DirectoryFeedToken>> {
	const rows = await db.findMany(directoryFeedTokensTable, {
		where: { feed_id: feedId },
		orderBy: [['created_at', 'desc']],
	})
	return toCamelCaseRows(rows)
}

/**
 * List active (non-revoked) tokens for a directory feed.
 */
export async function listActiveDirectoryFeedTokens(
	feedId: string,
): Promise<Array<DirectoryFeedToken>> {
	const rows = await db.findMany(directoryFeedTokensTable, {
		where: { feed_id: feedId, revoked_at: null },
		orderBy: [['created_at', 'desc']],
	})
	return toCamelCaseRows(rows)
}

/**
 * Revoke a token (soft delete).
 */
export async function revokeDirectoryFeedToken(
	token: string,
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000)
	const result = await db.updateMany(
		directoryFeedTokensTable,
		{ revoked_at: now },
		{ where: { token, revoked_at: null } },
	)
	return result.affectedRows > 0
}

/**
 * Update the last_used_at timestamp for a token.
 * Call this when a token is used to access a feed.
 */
export async function touchDirectoryFeedToken(token: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000)
	await db.updateMany(
		directoryFeedTokensTable,
		{ last_used_at: now },
		{ where: { token } },
	)
}

/**
 * Update a token's label.
 */
export async function updateDirectoryFeedTokenLabel(
	token: string,
	label: string,
): Promise<boolean> {
	const result = await db.updateMany(
		directoryFeedTokensTable,
		{ label },
		{ where: { token } },
	)
	return result.affectedRows > 0
}

/**
 * Permanently delete a token.
 */
export async function deleteDirectoryFeedToken(
	token: string,
): Promise<boolean> {
	return db.delete(directoryFeedTokensTable, token)
}

/**
 * Revoke all tokens for a feed.
 */
export async function revokeAllDirectoryFeedTokens(
	feedId: string,
): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await db.updateMany(
		directoryFeedTokensTable,
		{ revoked_at: now },
		{ where: { feed_id: feedId, revoked_at: null } },
	)
	return result.affectedRows
}
