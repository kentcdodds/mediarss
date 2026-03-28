import { column as c, createDatabase, table } from 'remix/data-table'
import { createSqliteDatabaseAdapter } from 'remix/data-table-sqlite'
import { db as sqliteDb } from './index.ts'

const sqliteAdapter = createSqliteDatabaseAdapter(sqliteDb)

export const dataTableDb = createDatabase(sqliteAdapter)

export const directoryFeedsTable = table({
	name: 'directory_feeds',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		name: c.text(),
		description: c.text(),
		subtitle: c.text().nullable(),
		directory_paths: c.text(),
		sort_fields: c.text(),
		sort_order: c.enum(['asc', 'desc'] as const),
		image_url: c.text().nullable(),
		author: c.text().nullable(),
		owner_name: c.text().nullable(),
		owner_email: c.text().nullable(),
		language: c.text(),
		explicit: c.text(),
		category: c.text().nullable(),
		link: c.text().nullable(),
		copyright: c.text().nullable(),
		feed_type: c.enum(['episodic', 'serial'] as const).nullable(),
		filter_in: c.text().nullable(),
		filter_out: c.text().nullable(),
		overrides: c.text().nullable(),
		created_at: c.integer(),
		updated_at: c.integer(),
	},
})

export const curatedFeedsTable = table({
	name: 'curated_feeds',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		name: c.text(),
		description: c.text(),
		subtitle: c.text().nullable(),
		sort_fields: c.text(),
		sort_order: c.enum(['asc', 'desc'] as const),
		image_url: c.text().nullable(),
		author: c.text().nullable(),
		owner_name: c.text().nullable(),
		owner_email: c.text().nullable(),
		language: c.text(),
		explicit: c.text(),
		category: c.text().nullable(),
		link: c.text().nullable(),
		copyright: c.text().nullable(),
		feed_type: c.enum(['episodic', 'serial'] as const).nullable(),
		overrides: c.text().nullable(),
		created_at: c.integer(),
		updated_at: c.integer(),
	},
})

export const feedItemsTable = table({
	name: 'feed_items',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		feed_id: c.text(),
		media_root: c.text(),
		relative_path: c.text(),
		position: c.integer().nullable(),
		added_at: c.integer(),
	},
})

export const directoryFeedTokensTable = table({
	name: 'directory_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: c.text(),
		feed_id: c.text(),
		label: c.text(),
		created_at: c.integer(),
		last_used_at: c.integer().nullable(),
		revoked_at: c.integer().nullable(),
	},
})

export const curatedFeedTokensTable = table({
	name: 'curated_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: c.text(),
		feed_id: c.text(),
		label: c.text(),
		created_at: c.integer(),
		last_used_at: c.integer().nullable(),
		revoked_at: c.integer().nullable(),
	},
})
