import { generateToken } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
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
export function createCuratedFeedToken(
	data: CreateCuratedFeedTokenData,
): CuratedFeedToken {
	const token = generateToken()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO curated_feed_tokens (token, feed_id, label, created_at)
			VALUES (?, ?, ?, ?);
		`,
	).run(token, data.feedId, data.label ?? '', now)

	return getCuratedFeedToken(token)!
}

/**
 * Get a token by its value.
 */
export function getCuratedFeedToken(
	token: string,
): CuratedFeedToken | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM curated_feed_tokens WHERE token = ? AND revoked_at IS NULL;`,
		)
		.get(token)
	return row ? parseRow(CuratedFeedTokenSchema, row) : undefined
}

/**
 * Get a curated feed by token.
 * This is the primary way to resolve a feed from a URL token.
 * Returns undefined if the token is invalid, revoked, or doesn't exist.
 */
export function getCuratedFeedByToken(token: string): CuratedFeed | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`
				SELECT cf.*
				FROM curated_feeds cf
				INNER JOIN curated_feed_tokens cft ON cf.id = cft.feed_id
				WHERE cft.token = ? AND cft.revoked_at IS NULL;
			`,
		)
		.get(token)
	return row ? parseRow(CuratedFeedSchema, row) : undefined
}

/**
 * List all tokens for a curated feed.
 */
export function listCuratedFeedTokens(feedId: string): Array<CuratedFeedToken> {
	const rows = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM curated_feed_tokens WHERE feed_id = ? ORDER BY created_at DESC;`,
		)
		.all(feedId)
	return parseRows(CuratedFeedTokenSchema, rows)
}

/**
 * List active (non-revoked) tokens for a curated feed.
 */
export function listActiveCuratedFeedTokens(
	feedId: string,
): Array<CuratedFeedToken> {
	const rows = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM curated_feed_tokens WHERE feed_id = ? AND revoked_at IS NULL ORDER BY created_at DESC;`,
		)
		.all(feedId)
	return parseRows(CuratedFeedTokenSchema, rows)
}

/**
 * Revoke a token (soft delete).
 */
export function revokeCuratedFeedToken(token: string): boolean {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(
			sql`UPDATE curated_feed_tokens SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL;`,
		)
		.run(now, token)
	return result.changes > 0
}

/**
 * Update the last_used_at timestamp for a token.
 * Call this when a token is used to access a feed.
 */
export function touchCuratedFeedToken(token: string): void {
	const now = Math.floor(Date.now() / 1000)
	db.query(
		sql`UPDATE curated_feed_tokens SET last_used_at = ? WHERE token = ?;`,
	).run(now, token)
}

/**
 * Update a token's label.
 */
export function updateCuratedFeedTokenLabel(
	token: string,
	label: string,
): boolean {
	const result = db
		.query(sql`UPDATE curated_feed_tokens SET label = ? WHERE token = ?;`)
		.run(label, token)
	return result.changes > 0
}

/**
 * Permanently delete a token.
 */
export function deleteCuratedFeedToken(token: string): boolean {
	const result = db
		.query(sql`DELETE FROM curated_feed_tokens WHERE token = ?;`)
		.run(token)
	return result.changes > 0
}

/**
 * Revoke all tokens for a feed.
 */
export function revokeAllCuratedFeedTokens(feedId: string): number {
	const now = Math.floor(Date.now() / 1000)
	const result = db
		.query(
			sql`UPDATE curated_feed_tokens SET revoked_at = ? WHERE feed_id = ? AND revoked_at IS NULL;`,
		)
		.run(now, feedId)
	return result.changes
}
