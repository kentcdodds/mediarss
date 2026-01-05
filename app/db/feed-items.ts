import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
import { type FeedItem, FeedItemSchema } from './types.ts'

export function addItemToFeed(
	feedId: string,
	filePath: string,
	position?: number,
): FeedItem {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO feed_items (id, feed_id, file_path, position, added_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (feed_id, file_path) DO UPDATE SET
				position = excluded.position,
				added_at = feed_items.added_at;
		`,
	).run(id, feedId, filePath, position ?? null, now)

	// Return the item (could be newly inserted or existing)
	const row = db
		.query<Record<string, unknown>, [string, string]>(
			sql`SELECT * FROM feed_items WHERE feed_id = ? AND file_path = ?;`,
		)
		.get(feedId, filePath)

	return parseRow(FeedItemSchema, row!)
}

export function removeItemFromFeed(feedId: string, filePath: string): boolean {
	const result = db
		.query(sql`DELETE FROM feed_items WHERE feed_id = ? AND file_path = ?;`)
		.run(feedId, filePath)
	return result.changes > 0
}

export function getItemsForFeed(feedId: string): Array<FeedItem> {
	const rows = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM feed_items WHERE feed_id = ? ORDER BY position ASC, added_at ASC;`,
		)
		.all(feedId)
	return parseRows(FeedItemSchema, rows)
}

export function reorderFeedItems(
	feedId: string,
	filePaths: Array<string>,
): void {
	// Update positions based on the order of filePaths array
	const updateStmt = db.query(
		sql`UPDATE feed_items SET position = ? WHERE feed_id = ? AND file_path = ?;`,
	)

	db.transaction(() => {
		for (let i = 0; i < filePaths.length; i++) {
			const filePath = filePaths[i]
			if (filePath) {
				updateStmt.run(i, feedId, filePath)
			}
		}
	})()
}

export function getItemByPath(
	feedId: string,
	filePath: string,
): FeedItem | undefined {
	const row = db
		.query<Record<string, unknown>, [string, string]>(
			sql`SELECT * FROM feed_items WHERE feed_id = ? AND file_path = ?;`,
		)
		.get(feedId, filePath)
	return row ? parseRow(FeedItemSchema, row) : undefined
}

export function clearFeedItems(feedId: string): number {
	const result = db
		.query(sql`DELETE FROM feed_items WHERE feed_id = ?;`)
		.run(feedId)
	return result.changes
}
