import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { toCamelCaseRow, toCamelCaseRows } from './rows.ts'
import { feedItemsTable } from './schema.ts'
import { type FeedItem } from './types.ts'

export async function addItemToFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
	position?: number,
): Promise<FeedItem> {
	const now = Math.floor(Date.now() / 1000)

	const existing = await getItemByPath(feedId, mediaRoot, relativePath)
	if (existing) {
		const updated = await db.update(feedItemsTable, existing.id, {
			position: position ?? null,
			added_at: now,
		})
		return toCamelCaseRow(updated)
	}

	const id = generateId()
	const created = await db.create(
		feedItemsTable,
		{
			id,
			feed_id: feedId,
			media_root: mediaRoot,
			relative_path: relativePath,
			position: position ?? null,
			added_at: now,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(created)
}

export async function removeItemFromFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
): Promise<boolean> {
	const result = await db.deleteMany(feedItemsTable, {
		where: {
			feed_id: feedId,
			media_root: mediaRoot,
			relative_path: relativePath,
		},
	})
	return result.affectedRows > 0
}

export async function getItemsForFeed(
	feedId: string,
): Promise<Array<FeedItem>> {
	const rows = await db.findMany(feedItemsTable, {
		where: { feed_id: feedId },
		orderBy: [
			['position', 'asc'],
			['added_at', 'asc'],
		],
	})
	return toCamelCaseRows(rows)
}

export async function listAllFeedItems(): Promise<Array<FeedItem>> {
	const rows = await db.findMany(feedItemsTable)
	return toCamelCaseRows(rows)
}

export type ReorderItem = {
	mediaRoot: string
	relativePath: string
}

export async function reorderFeedItems(
	feedId: string,
	items: Array<ReorderItem>,
): Promise<void> {
	await db.transaction(async (tx) => {
		for (let i = 0; i < items.length; i++) {
			const item = items[i]
			if (item) {
				await tx.updateMany(
					feedItemsTable,
					{ position: i },
					{
						where: {
							feed_id: feedId,
							media_root: item.mediaRoot,
							relative_path: item.relativePath,
						},
					},
				)
			}
		}
	})
}

export async function getItemByPath(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
): Promise<FeedItem | undefined> {
	const row = await db.findOne(feedItemsTable, {
		where: {
			feed_id: feedId,
			media_root: mediaRoot,
			relative_path: relativePath,
		},
	})
	return row ? toCamelCaseRow(row) : undefined
}

export async function clearFeedItems(feedId: string): Promise<number> {
	const result = await db.deleteMany(feedItemsTable, {
		where: { feed_id: feedId },
	})
	return result.affectedRows
}
