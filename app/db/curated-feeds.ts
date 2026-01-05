import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
import { type CuratedFeed, CuratedFeedSchema, type SortOrder } from './types.ts'

export type CreateCuratedFeedData = {
	name: string
	description?: string
	sortBy?: string
	sortOrder?: SortOrder
}

export function createCuratedFeed(data: CreateCuratedFeedData): CuratedFeed {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO curated_feeds (id, name, description, sort_by, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?);
		`,
	).run(
		id,
		data.name,
		data.description ?? '',
		data.sortBy ?? 'position',
		data.sortOrder ?? 'asc',
		now,
		now,
	)

	return getCuratedFeedById(id)!
}

export function getCuratedFeedById(id: string): CuratedFeed | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM curated_feeds WHERE id = ?;`,
		)
		.get(id)
	return row ? parseRow(CuratedFeedSchema, row) : undefined
}

export function listCuratedFeeds(): Array<CuratedFeed> {
	const rows = db
		.query<Record<string, unknown>, []>(
			sql`SELECT * FROM curated_feeds ORDER BY created_at DESC;`,
		)
		.all()
	return parseRows(CuratedFeedSchema, rows)
}

export type UpdateCuratedFeedData = {
	name?: string
	description?: string
	sortBy?: string
	sortOrder?: SortOrder
}

export function updateCuratedFeed(
	id: string,
	data: UpdateCuratedFeedData,
): CuratedFeed | undefined {
	const existing = getCuratedFeedById(id)
	if (!existing) return undefined

	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			UPDATE curated_feeds
			SET name = ?, description = ?, sort_by = ?, sort_order = ?, updated_at = ?
			WHERE id = ?;
		`,
	).run(
		data.name ?? existing.name,
		data.description ?? existing.description,
		data.sortBy ?? existing.sortBy,
		data.sortOrder ?? existing.sortOrder,
		now,
		id,
	)

	return getCuratedFeedById(id)
}

export function deleteCuratedFeed(id: string): boolean {
	const result = db.query(sql`DELETE FROM curated_feeds WHERE id = ?;`).run(id)
	return result.changes > 0
}
