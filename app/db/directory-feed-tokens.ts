import { generateToken } from '#app/helpers/crypto.ts'
import {
	dataTableDb,
	directoryFeedTokensTable,
	directoryFeedsTable,
} from './data-table.ts'
import { parseRow, parseRows } from './sql.ts'
import {
	type DirectoryFeed,
	DirectoryFeedSchema,
	type DirectoryFeedToken,
	DirectoryFeedTokenSchema,
} from './types.ts'

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

	await dataTableDb.create(directoryFeedTokensTable, {
		token,
		feed_id: data.feedId,
		label: data.label ?? '',
		created_at: now,
		last_used_at: null,
		revoked_at: null,
	})

	const created = await getDirectoryFeedToken(token)
	if (!created) {
		throw new Error(`Failed to create directory feed token "${token}"`)
	}
	return created
}

/**
 * Get a token by its value.
 */
export async function getDirectoryFeedToken(
	token: string,
): Promise<DirectoryFeedToken | undefined> {
	const row = await dataTableDb.findOne(directoryFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	return row ? parseRow(DirectoryFeedTokenSchema, row) : undefined
}

/**
 * Get a directory feed by token.
 * This is the primary way to resolve a feed from a URL token.
 * Returns undefined if the token is invalid, revoked, or doesn't exist.
 */
export async function getDirectoryFeedByToken(
	token: string,
): Promise<DirectoryFeed | undefined> {
	const tokenRow = await dataTableDb.findOne(directoryFeedTokensTable, {
		where: { token, revoked_at: null },
	})
	if (!tokenRow) return undefined

	const feedRow = await dataTableDb.find(directoryFeedsTable, tokenRow.feed_id)
	return feedRow ? parseRow(DirectoryFeedSchema, feedRow) : undefined
}

/**
 * List all tokens for a directory feed.
 */
export async function listDirectoryFeedTokens(
	feedId: string,
): Promise<Array<DirectoryFeedToken>> {
	const rows = await dataTableDb.findMany(directoryFeedTokensTable, {
		where: { feed_id: feedId },
		orderBy: [['created_at', 'desc']],
	})
	return parseRows(DirectoryFeedTokenSchema, rows)
}

/**
 * List active (non-revoked) tokens for a directory feed.
 */
export async function listActiveDirectoryFeedTokens(
	feedId: string,
): Promise<Array<DirectoryFeedToken>> {
	const rows = await dataTableDb.findMany(directoryFeedTokensTable, {
		where: { feed_id: feedId, revoked_at: null },
		orderBy: [['created_at', 'desc']],
	})
	return parseRows(DirectoryFeedTokenSchema, rows)
}

/**
 * Revoke a token (soft delete).
 */
export async function revokeDirectoryFeedToken(
	token: string,
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000)
	const result = await dataTableDb.updateMany(
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
	await dataTableDb.updateMany(
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
	const result = await dataTableDb.updateMany(
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
	return dataTableDb.delete(directoryFeedTokensTable, token)
}

/**
 * Revoke all tokens for a feed.
 */
export async function revokeAllDirectoryFeedTokens(
	feedId: string,
): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const result = await dataTableDb.updateMany(
		directoryFeedTokensTable,
		{ revoked_at: now },
		{ where: { feed_id: feedId, revoked_at: null } },
	)
	return result.affectedRows
}
