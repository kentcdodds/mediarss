import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { toCamelCaseRow, toCamelCaseRows } from './rows.ts'
import { curatedFeedsTable } from './schema.ts'
import { type CuratedFeed, type SortOrder } from './types.ts'

export type CreateCuratedFeedData = {
	name: string
	description?: string
	subtitle?: string | null
	sortFields?: string
	sortOrder?: SortOrder
	author?: string | null
	ownerName?: string | null
	ownerEmail?: string | null
	language?: string
	explicit?: string
	category?: string | null
	link?: string | null
	copyright?: string | null
	feedType?: 'episodic' | 'serial'
	overrides?: string | null
}

export async function createCuratedFeed(
	data: CreateCuratedFeedData,
): Promise<CuratedFeed> {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	const created = await db.create(
		curatedFeedsTable,
		{
			id,
			name: data.name,
			description: data.description ?? '',
			subtitle: data.subtitle ?? null,
			sort_fields: data.sortFields ?? 'position',
			sort_order: data.sortOrder ?? 'asc',
			author: data.author ?? null,
			owner_name: data.ownerName ?? null,
			owner_email: data.ownerEmail ?? null,
			language: data.language ?? 'en',
			explicit: data.explicit ?? 'no',
			category: data.category ?? null,
			link: data.link ?? null,
			copyright: data.copyright ?? null,
			feed_type: data.feedType ?? 'episodic',
			overrides: data.overrides ?? null,
			created_at: now,
			updated_at: now,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(created)
}

export async function getCuratedFeedById(
	id: string,
): Promise<CuratedFeed | undefined> {
	const row = await db.find(curatedFeedsTable, id)
	return row ? toCamelCaseRow(row) : undefined
}

export async function listCuratedFeeds(): Promise<Array<CuratedFeed>> {
	const rows = await db.findMany(curatedFeedsTable, {
		orderBy: [['created_at', 'desc']],
	})
	return toCamelCaseRows(rows)
}

export type UpdateCuratedFeedData = {
	name?: string
	description?: string
	subtitle?: string | null
	sortFields?: string
	sortOrder?: SortOrder
	author?: string | null
	ownerName?: string | null
	ownerEmail?: string | null
	language?: string
	explicit?: string
	category?: string | null
	link?: string | null
	copyright?: string | null
	feedType?: 'episodic' | 'serial'
	overrides?: string | null
}

export async function updateCuratedFeed(
	id: string,
	data: UpdateCuratedFeedData,
): Promise<CuratedFeed | undefined> {
	const existing = await getCuratedFeedById(id)
	if (!existing) return undefined

	const now = Math.floor(Date.now() / 1000)

	const updated = await db.update(curatedFeedsTable, id, {
		name: data.name ?? existing.name,
		description: data.description ?? existing.description,
		subtitle: data.subtitle !== undefined ? data.subtitle : existing.subtitle,
		sort_fields: data.sortFields ?? existing.sortFields,
		sort_order: data.sortOrder ?? existing.sortOrder,
		author: data.author !== undefined ? data.author : existing.author,
		owner_name:
			data.ownerName !== undefined ? data.ownerName : existing.ownerName,
		owner_email:
			data.ownerEmail !== undefined ? data.ownerEmail : existing.ownerEmail,
		language: data.language ?? existing.language,
		explicit: data.explicit ?? existing.explicit,
		category: data.category !== undefined ? data.category : existing.category,
		link: data.link !== undefined ? data.link : existing.link,
		copyright:
			data.copyright !== undefined ? data.copyright : existing.copyright,
		feed_type: data.feedType ?? existing.feedType,
		overrides:
			data.overrides !== undefined ? data.overrides : existing.overrides,
		updated_at: now,
	})

	return toCamelCaseRow(updated)
}

export async function deleteCuratedFeed(id: string): Promise<boolean> {
	return db.delete(curatedFeedsTable, id)
}
