import { enum_, nullable, number, string } from 'remix/data-schema'
import { createDatabase, createTable } from 'remix/data-table'
import { createBunSqliteDatabaseAdapter } from './bun-data-table-adapter.ts'
import { db as sqliteDb } from './index.ts'

const sqliteAdapter = createBunSqliteDatabaseAdapter(sqliteDb)

export const dataTableDb = createDatabase(sqliteAdapter)

export const directoryFeedsTable = createTable({
	name: 'directory_feeds',
	primaryKey: 'id',
	columns: {
		id: string(),
		name: string(),
		description: string(),
		subtitle: nullable(string()),
		directory_paths: string(),
		sort_fields: string(),
		sort_order: enum_(['asc', 'desc'] as const),
		image_url: nullable(string()),
		author: nullable(string()),
		owner_name: nullable(string()),
		owner_email: nullable(string()),
		language: string(),
		explicit: string(),
		category: nullable(string()),
		link: nullable(string()),
		copyright: nullable(string()),
		feed_type: nullable(enum_(['episodic', 'serial'] as const)),
		filter_in: nullable(string()),
		filter_out: nullable(string()),
		overrides: nullable(string()),
		created_at: number(),
		updated_at: number(),
	},
})

export const curatedFeedsTable = createTable({
	name: 'curated_feeds',
	primaryKey: 'id',
	columns: {
		id: string(),
		name: string(),
		description: string(),
		subtitle: nullable(string()),
		sort_fields: string(),
		sort_order: enum_(['asc', 'desc'] as const),
		image_url: nullable(string()),
		author: nullable(string()),
		owner_name: nullable(string()),
		owner_email: nullable(string()),
		language: string(),
		explicit: string(),
		category: nullable(string()),
		link: nullable(string()),
		copyright: nullable(string()),
		feed_type: nullable(enum_(['episodic', 'serial'] as const)),
		overrides: nullable(string()),
		created_at: number(),
		updated_at: number(),
	},
})

export const feedItemsTable = createTable({
	name: 'feed_items',
	primaryKey: 'id',
	columns: {
		id: string(),
		feed_id: string(),
		media_root: string(),
		relative_path: string(),
		position: nullable(number()),
		added_at: number(),
	},
})

export const directoryFeedTokensTable = createTable({
	name: 'directory_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: string(),
		feed_id: string(),
		label: string(),
		created_at: number(),
		last_used_at: nullable(number()),
		revoked_at: nullable(number()),
	},
})

export const curatedFeedTokensTable = createTable({
	name: 'curated_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: string(),
		feed_id: string(),
		label: string(),
		created_at: number(),
		last_used_at: nullable(number()),
		revoked_at: nullable(number()),
	},
})
