import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
import {
	type DirectoryFeed,
	DirectoryFeedSchema,
	type SortOrder,
} from './types.ts'

export type CreateDirectoryFeedData = {
	name: string
	description?: string
	directoryPath: string
	sortBy?: string
	sortOrder?: SortOrder
}

export function createDirectoryFeed(
	data: CreateDirectoryFeedData,
): DirectoryFeed {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO directory_feeds (id, name, description, directory_path, sort_by, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?);
		`,
	).run(
		id,
		data.name,
		data.description ?? '',
		data.directoryPath,
		data.sortBy ?? 'filename',
		data.sortOrder ?? 'asc',
		now,
		now,
	)

	return getDirectoryFeedById(id)!
}

export function getDirectoryFeedById(id: string): DirectoryFeed | undefined {
	const row = db
		.query<Record<string, unknown>, [string]>(
			sql`SELECT * FROM directory_feeds WHERE id = ?;`,
		)
		.get(id)
	return row ? parseRow(DirectoryFeedSchema, row) : undefined
}

export function listDirectoryFeeds(): Array<DirectoryFeed> {
	const rows = db
		.query<Record<string, unknown>, []>(
			sql`SELECT * FROM directory_feeds ORDER BY created_at DESC;`,
		)
		.all()
	return parseRows(DirectoryFeedSchema, rows)
}

export type UpdateDirectoryFeedData = {
	name?: string
	description?: string
	directoryPath?: string
	sortBy?: string
	sortOrder?: SortOrder
}

export function updateDirectoryFeed(
	id: string,
	data: UpdateDirectoryFeedData,
): DirectoryFeed | undefined {
	const existing = getDirectoryFeedById(id)
	if (!existing) return undefined

	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			UPDATE directory_feeds
			SET name = ?, description = ?, directory_path = ?, sort_by = ?, sort_order = ?, updated_at = ?
			WHERE id = ?;
		`,
	).run(
		data.name ?? existing.name,
		data.description ?? existing.description,
		data.directoryPath ?? existing.directoryPath,
		data.sortBy ?? existing.sortBy,
		data.sortOrder ?? existing.sortOrder,
		now,
		id,
	)

	return getDirectoryFeedById(id)
}

export function deleteDirectoryFeed(id: string): boolean {
	const result = db
		.query(sql`DELETE FROM directory_feeds WHERE id = ?;`)
		.run(id)
	return result.changes > 0
}
