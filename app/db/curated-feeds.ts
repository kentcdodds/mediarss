import { db } from './index.ts'
import { sql, snakeToCamel } from './sql.ts'
import type { CuratedFeed, SortOrder } from './types.ts'
import { generateId, generateToken } from '#app/helpers/crypto.ts'

type CuratedFeedRow = {
	id: string
	name: string
	description: string
	token: string
	sort_by: string
	sort_order: SortOrder
	created_at: number
	updated_at: number
}

function rowToCuratedFeed(row: CuratedFeedRow): CuratedFeed {
	return snakeToCamel(row) as CuratedFeed
}

export type CreateCuratedFeedData = {
	name: string
	description?: string
	sortBy?: string
	sortOrder?: SortOrder
}

export function createCuratedFeed(data: CreateCuratedFeedData): CuratedFeed {
	const id = generateId()
	const token = generateToken()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO curated_feeds (id, name, description, token, sort_by, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?);
		`,
	).run(
		id,
		data.name,
		data.description ?? '',
		token,
		data.sortBy ?? 'position',
		data.sortOrder ?? 'asc',
		now,
		now,
	)

	return getCuratedFeedById(id)!
}

export function getCuratedFeedByToken(token: string): CuratedFeed | undefined {
	const row = db
		.query<CuratedFeedRow, [string]>(
			sql`SELECT * FROM curated_feeds WHERE token = ?;`,
		)
		.get(token)
	return row ? rowToCuratedFeed(row) : undefined
}

export function getCuratedFeedById(id: string): CuratedFeed | undefined {
	const row = db
		.query<CuratedFeedRow, [string]>(
			sql`SELECT * FROM curated_feeds WHERE id = ?;`,
		)
		.get(id)
	return row ? rowToCuratedFeed(row) : undefined
}

export function listCuratedFeeds(): Array<CuratedFeed> {
	const rows = db
		.query<CuratedFeedRow, []>(
			sql`SELECT * FROM curated_feeds ORDER BY created_at DESC;`,
		)
		.all()
	return rows.map(rowToCuratedFeed)
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
