import { generateId } from '#app/helpers/crypto.ts'
import { db } from './index.ts'
import { toCamelCaseRow, toCamelCaseRows } from './rows.ts'
import { directoryFeedsTable } from './schema.ts'
import { type DirectoryFeed, type SortOrder } from './types.ts'

export type CreateDirectoryFeedData = {
	name: string
	description?: string
	subtitle?: string | null
	directoryPaths: Array<string> // Array of "mediaRoot:relativePath" strings
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
	filterIn?: string | null
	filterOut?: string | null
	overrides?: string | null
}

export async function createDirectoryFeed(
	data: CreateDirectoryFeedData,
): Promise<DirectoryFeed> {
	const id = generateId()
	const now = Math.floor(Date.now() / 1000)

	const created = await db.create(
		directoryFeedsTable,
		{
			id,
			name: data.name,
			description: data.description ?? '',
			subtitle: data.subtitle ?? null,
			directory_paths: JSON.stringify(data.directoryPaths),
			sort_fields: data.sortFields ?? 'filename',
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
			filter_in: data.filterIn ?? null,
			filter_out: data.filterOut ?? null,
			overrides: data.overrides ?? null,
			created_at: now,
			updated_at: now,
		},
		{ returnRow: true },
	)
	return toCamelCaseRow(created)
}

export async function getDirectoryFeedById(
	id: string,
): Promise<DirectoryFeed | undefined> {
	const row = await db.find(directoryFeedsTable, id)
	return row ? toCamelCaseRow(row) : undefined
}

export async function listDirectoryFeeds(): Promise<Array<DirectoryFeed>> {
	const rows = await db.findMany(directoryFeedsTable, {
		orderBy: [['created_at', 'desc']],
	})
	return toCamelCaseRows(rows)
}

export type UpdateDirectoryFeedData = {
	name?: string
	description?: string
	subtitle?: string | null
	directoryPaths?: Array<string> // Array of "mediaRoot:relativePath" strings
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
	filterIn?: string | null
	filterOut?: string | null
	overrides?: string | null
}

export async function updateDirectoryFeed(
	id: string,
	data: UpdateDirectoryFeedData,
): Promise<DirectoryFeed | undefined> {
	const existing = await getDirectoryFeedById(id)
	if (!existing) return undefined

	const now = Math.floor(Date.now() / 1000)

	const updated = await db.update(directoryFeedsTable, id, {
		name: data.name ?? existing.name,
		description: data.description ?? existing.description,
		subtitle: data.subtitle !== undefined ? data.subtitle : existing.subtitle,
		directory_paths: data.directoryPaths
			? JSON.stringify(data.directoryPaths)
			: existing.directoryPaths,
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
		filter_in: data.filterIn !== undefined ? data.filterIn : existing.filterIn,
		filter_out:
			data.filterOut !== undefined ? data.filterOut : existing.filterOut,
		overrides:
			data.overrides !== undefined ? data.overrides : existing.overrides,
		updated_at: now,
	})

	return toCamelCaseRow(updated)
}

export async function deleteDirectoryFeed(id: string): Promise<boolean> {
	return db.delete(directoryFeedsTable, id)
}

/**
 * Parse the directoryPaths JSON string into an array.
 */
export function parseDirectoryPaths(feed: DirectoryFeed): Array<string> {
	try {
		return JSON.parse(feed.directoryPaths) as Array<string>
	} catch {
		return []
	}
}
