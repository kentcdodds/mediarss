import { generateToken } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
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
export function createDirectoryFeedToken(
	data: CreateDirectoryFeedTokenData,
): DirectoryFeedToken {
	const token = generateToken()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO directory_feed_tokens (token, feed_id, label, created_at)
			VALUES (?, ?, ?, ?);
		`,
	).run(token, data.feedId, data.label ?? '', now)

	return getDirectoryFeedToken(token)!
}

/**
 * Get a token by its value.
 */
export function getDirectoryFeedToken(
	token: string,
): DirectoryFeedToken | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM directory_feed_tokens WHERE token = ? AND revoked_at IS NULL;`,
		)
		.get(token)
	return row ? parseRow(DirectoryFeedTokenSchema, row) : undefined
}

/**
 * Get a directory feed by token.
 * This is the primary way to resolve a feed from a URL token.
 * Returns undefined if the token is invalid, revoked, or doesn't exist.
 */
export function getDirectoryFeedByToken(
	token: string,
): DirectoryFeed | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`
				SELECT df.*
				FROM directory_feeds df
				INNER JOIN directory_feed_tokens dft ON df.id = dft.feed_id
				WHERE dft.token = ? AND dft.revoked_at IS NULL;
			`,
		)
		.get(token)
	return row ? parseRow(DirectoryFeedSchema, row) : undefined
}

/**
 * List all tokens for a directory feed.
 */
export function listDirectoryFeedTokens(
	feedId: string,
): Array<DirectoryFeedToken> {
	const rows = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM directory_feed_tokens WHERE feed_id = ? ORDER BY created_at DESC;`,
		)
		.all(feedId)
	return parseRows(DirectoryFeedTokenSchema, rows)
}

/**
 * List active (non-revoked) tokens for a directory feed.
 */
export function listActiveDirectoryFeedTokens(
	feedId: string,
): Array<DirectoryFeedToken> {
	const rows = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM directory_feed_tokens WHERE feed_id = ? AND revoked_at IS NULL ORDER BY created_at DESC;`,
		)
		.all(feedId)
	return parseRows(DirectoryFeedTokenSchema, rows)
}

/**
 * Revoke a token (soft delete).
 */
export function revokeDirectoryFeedToken(token: string): boolean {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(
			sql`UPDATE directory_feed_tokens SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL;`,
		)
		.run(now, token)
	return result.changes > 0
}

/**
 * Update the last_used_at timestamp for a token.
 * Call this when a token is used to access a feed.
 */
export function touchDirectoryFeedToken(token: string): void {
	const now = Math.floor(Date.now() / 1000)
	db.query(
		sql`UPDATE directory_feed_tokens SET last_used_at = ? WHERE token = ?;`,
	).run(now, token)
}

/**
 * Update a token's label.
 */
export function updateDirectoryFeedTokenLabel(
	token: string,
	label: string,
): boolean {
	const result = db
		.query(sql`UPDATE directory_feed_tokens SET label = ? WHERE token = ?;`)
		.run(label, token)
	return result.changes > 0
}

/**
 * Permanently delete a token.
 */
export function deleteDirectoryFeedToken(token: string): boolean {
	const result = db
		.query(sql`DELETE FROM directory_feed_tokens WHERE token = ?;`)
		.run(token)
	return result.changes > 0
}

/**
 * Revoke all tokens for a feed.
 */
export function revokeAllDirectoryFeedTokens(feedId: string): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(
			sql`UPDATE directory_feed_tokens SET revoked_at = ? WHERE feed_id = ? AND revoked_at IS NULL;`,
		)
		.run(now, feedId)
	return result.changes
}
