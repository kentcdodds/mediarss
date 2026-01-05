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
	sortFields?: string
	sortOrder?: SortOrder
	imageUrl?: string | null
	author?: string | null
	ownerName?: string | null
	ownerEmail?: string | null
	language?: string
	explicit?: string
	category?: string | null
	link?: string | null
	filterIn?: string | null
	filterOut?: string | null
	overrides?: string | null
}

export function createDirectoryFeed(
	data: CreateDirectoryFeedData,
): DirectoryFeed {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO directory_feeds (
				id, name, description, directory_path, sort_fields, sort_order,
				image_url, author, owner_name, owner_email, language, explicit,
				category, link, filter_in, filter_out, overrides,
				created_at, updated_at
			)
			VALUES (
				$id, $name, $description, $directoryPath, $sortFields, $sortOrder,
				$imageUrl, $author, $ownerName, $ownerEmail, $language, $explicit,
				$category, $link, $filterIn, $filterOut, $overrides,
				$createdAt, $updatedAt
			);
		`,
	).run({
		$id: id,
		$name: data.name,
		$description: data.description ?? '',
		$directoryPath: data.directoryPath,
		$sortFields: data.sortFields ?? 'filename',
		$sortOrder: data.sortOrder ?? 'asc',
		$imageUrl: data.imageUrl ?? null,
		$author: data.author ?? null,
		$ownerName: data.ownerName ?? null,
		$ownerEmail: data.ownerEmail ?? null,
		$language: data.language ?? 'en',
		$explicit: data.explicit ?? 'no',
		$category: data.category ?? null,
		$link: data.link ?? null,
		$filterIn: data.filterIn ?? null,
		$filterOut: data.filterOut ?? null,
		$overrides: data.overrides ?? null,
		$createdAt: now,
		$updatedAt: now,
	})

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
	sortFields?: string
	sortOrder?: SortOrder
	imageUrl?: string | null
	author?: string | null
	ownerName?: string | null
	ownerEmail?: string | null
	language?: string
	explicit?: string
	category?: string | null
	link?: string | null
	filterIn?: string | null
	filterOut?: string | null
	overrides?: string | null
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
			SET name = $name, description = $description, directory_path = $directoryPath,
				sort_fields = $sortFields, sort_order = $sortOrder,
				image_url = $imageUrl, author = $author, owner_name = $ownerName,
				owner_email = $ownerEmail, language = $language, explicit = $explicit,
				category = $category, link = $link, filter_in = $filterIn,
				filter_out = $filterOut, overrides = $overrides, updated_at = $updatedAt
			WHERE id = $id;
		`,
	).run({
		$id: id,
		$name: data.name ?? existing.name,
		$description: data.description ?? existing.description,
		$directoryPath: data.directoryPath ?? existing.directoryPath,
		$sortFields: data.sortFields ?? existing.sortFields,
		$sortOrder: data.sortOrder ?? existing.sortOrder,
		$imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
		$author: data.author !== undefined ? data.author : existing.author,
		$ownerName:
			data.ownerName !== undefined ? data.ownerName : existing.ownerName,
		$ownerEmail:
			data.ownerEmail !== undefined ? data.ownerEmail : existing.ownerEmail,
		$language: data.language ?? existing.language,
		$explicit: data.explicit ?? existing.explicit,
		$category: data.category !== undefined ? data.category : existing.category,
		$link: data.link !== undefined ? data.link : existing.link,
		$filterIn: data.filterIn !== undefined ? data.filterIn : existing.filterIn,
		$filterOut:
			data.filterOut !== undefined ? data.filterOut : existing.filterOut,
		$overrides:
			data.overrides !== undefined ? data.overrides : existing.overrides,
		$updatedAt: now,
	})

	return getDirectoryFeedById(id)
}

export function deleteDirectoryFeed(id: string): boolean {
	const result = db
		.query(sql`DELETE FROM directory_feeds WHERE id = ?;`)
		.run(id)
	return result.changes > 0
}
