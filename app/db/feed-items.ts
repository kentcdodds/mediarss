import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
import { type FeedItem, FeedItemSchema } from './types.ts'

export function addItemToFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
	position?: number,
): FeedItem {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO feed_items (id, feed_id, media_root, relative_path, position, added_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (feed_id, media_root, relative_path) DO UPDATE SET
				position = excluded.position,
				added_at = feed_items.added_at;
		`,
	).run(id, feedId, mediaRoot, relativePath, position ?? null, now)

	// Return the item (could be newly inserted or existing)
	const row = db
		.query<Record<string, unknown>, [string, string, string]>(
			sql`SELECT * FROM feed_items WHERE feed_id = ? AND media_root = ? AND relative_path = ?;`,
		)
		.get(feedId, mediaRoot, relativePath)

	return parseRow(FeedItemSchema, row!)
}

export function removeItemFromFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
): boolean {
	const result = db
		.query(
			sql`DELETE FROM feed_items WHERE feed_id = ? AND media_root = ? AND relative_path = ?;`,
		)
		.run(feedId, mediaRoot, relativePath)
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

export type ReorderItem = {
	mediaRoot: string
	relativePath: string
}

export function reorderFeedItems(
	feedId: string,
	items: Array<ReorderItem>,
): void {
	// Update positions based on the order of items array
	const updateStmt = db.query(
		sql`UPDATE feed_items SET position = ? WHERE feed_id = ? AND media_root = ? AND relative_path = ?;`,
	)

	db.transaction(() => {
		for (let i = 0; i < items.length; i++) {
			const item = items[i]
			if (item) {
				updateStmt.run(i, feedId, item.mediaRoot, item.relativePath)
			}
		}
	})()
}

export function getItemByPath(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
): FeedItem | undefined {
	const row = db
		.query<Record<string, unknown>, [string, string, string]>(
			sql`SELECT * FROM feed_items WHERE feed_id = ? AND media_root = ? AND relative_path = ?;`,
		)
		.get(feedId, mediaRoot, relativePath)
	return row ? parseRow(FeedItemSchema, row) : undefined
}

export function clearFeedItems(feedId: string): number {
	const result = db
		.query(sql`DELETE FROM feed_items WHERE feed_id = ?;`)
		.run(feedId)
	return result.changes
}
