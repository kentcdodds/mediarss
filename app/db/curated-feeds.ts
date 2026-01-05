import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { parseRow, parseRows, sql } from './sql.ts'
import { type CuratedFeed, CuratedFeedSchema, type SortOrder } from './types.ts'

export type CreateCuratedFeedData = {
	name: string
	description?: string
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
	overrides?: string | null
}

export function createCuratedFeed(data: CreateCuratedFeedData): CuratedFeed {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO curated_feeds (
				id, name, description, sort_fields, sort_order,
				image_url, author, owner_name, owner_email, language, explicit,
				category, link, overrides,
				created_at, updated_at
			)
			VALUES (
				$id, $name, $description, $sortFields, $sortOrder,
				$imageUrl, $author, $ownerName, $ownerEmail, $language, $explicit,
				$category, $link, $overrides,
				$createdAt, $updatedAt
			);
		`,
	).run({
		$id: id,
		$name: data.name,
		$description: data.description ?? '',
		$sortFields: data.sortFields ?? 'position',
		$sortOrder: data.sortOrder ?? 'asc',
		$imageUrl: data.imageUrl ?? null,
		$author: data.author ?? null,
		$ownerName: data.ownerName ?? null,
		$ownerEmail: data.ownerEmail ?? null,
		$language: data.language ?? 'en',
		$explicit: data.explicit ?? 'no',
		$category: data.category ?? null,
		$link: data.link ?? null,
		$overrides: data.overrides ?? null,
		$createdAt: now,
		$updatedAt: now,
	})

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
	overrides?: string | null
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
			SET name = $name, description = $description, sort_fields = $sortFields,
				sort_order = $sortOrder, image_url = $imageUrl, author = $author,
				owner_name = $ownerName, owner_email = $ownerEmail, language = $language,
				explicit = $explicit, category = $category, link = $link,
				overrides = $overrides, updated_at = $updatedAt
			WHERE id = $id;
		`,
	).run({
		$id: id,
		$name: data.name ?? existing.name,
		$description: data.description ?? existing.description,
		$sortFields: data.sortFields ?? existing.sortFields,
		$sortOrder: data.sortOrder ?? existing.sortOrder,
		$imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
		$author: data.author !== undefined ? data.author : existing.author,
		$ownerName: data.ownerName !== undefined ? data.ownerName : existing.ownerName,
		$ownerEmail: data.ownerEmail !== undefined ? data.ownerEmail : existing.ownerEmail,
		$language: data.language ?? existing.language,
		$explicit: data.explicit ?? existing.explicit,
		$category: data.category !== undefined ? data.category : existing.category,
		$link: data.link !== undefined ? data.link : existing.link,
		$overrides: data.overrides !== undefined ? data.overrides : existing.overrides,
		$updatedAt: now,
	})

	return getCuratedFeedById(id)
}

export function deleteCuratedFeed(id: string): boolean {
	const result = db.query(sql`DELETE FROM curated_feeds WHERE id = ?;`).run(id)
	return result.changes > 0
}
