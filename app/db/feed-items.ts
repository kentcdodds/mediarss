import { generateId } from '#app/helpers/crypto.ts'
import { dataTableDb, feedItemsTable } from './data-table.ts'
import { parseRow, parseRows } from './sql.ts'
import { type FeedItem, FeedItemSchema } from './types.ts'

export async function addItemToFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
	position?: number,
): Promise<FeedItem> {
	const now = Math.floor(Date.now() / 1000)

	const existing = await getItemByPath(feedId, mediaRoot, relativePath)
	if (existing) {
		await dataTableDb.update(feedItemsTable, existing.id, {
			position: position ?? null,
			added_at: now,
		})
		const updated = await dataTableDb.find(feedItemsTable, existing.id)
		if (!updated) {
			throw new Error(`Failed to update feed item "${existing.id}"`)
		}
		return parseRow(FeedItemSchema, updated)
	}

	const id = generateId()
	await dataTableDb.create(feedItemsTable, {
		feed_id: feedId,
		id,
		media_root: mediaRoot,
		relative_path: relativePath,
		position: position ?? null,
		added_at: now,
	})
	const created = await dataTableDb.find(feedItemsTable, id)
	if (!created) {
		throw new Error(`Failed to create feed item "${id}"`)
	}
	return parseRow(FeedItemSchema, created)
}

export async function removeItemFromFeed(
	feedId: string,
	mediaRoot: string,
	relativePath: string,
): Promise<boolean> {
	const result = await dataTableDb.deleteMany(feedItemsTable, {
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
	const rows = await dataTableDb.findMany(feedItemsTable, {
		where: { feed_id: feedId },
		orderBy: [
			['position', 'asc'],
			['added_at', 'asc'],
		],
	})
	return parseRows(FeedItemSchema, rows)
}

export type ReorderItem = {
	mediaRoot: string
	relativePath: string
}

export async function reorderFeedItems(
	feedId: string,
	items: Array<ReorderItem>,
): Promise<void> {
	await dataTableDb.transaction(async (tx) => {
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
	const row = await dataTableDb.findOne(feedItemsTable, {
		where: {
			feed_id: feedId,
			media_root: mediaRoot,
			relative_path: relativePath,
		},
	})
	return row ? parseRow(FeedItemSchema, row) : undefined
}

export async function clearFeedItems(feedId: string): Promise<number> {
	const result = await dataTableDb.deleteMany(feedItemsTable, {
		where: { feed_id: feedId },
	})
	return result.affectedRows
}
