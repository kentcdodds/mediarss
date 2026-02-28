import type { Database as BunDatabase } from 'bun:sqlite'
import { createDatabase, createTable } from 'remix/data-table'
import { createSqliteDatabaseAdapter } from 'remix/data-table-sqlite'
import { enum_, nullable, number, string } from 'remix/data-schema'
import { db as sqliteDb } from './index.ts'

type BunStatementResult = {
	changes: number
	lastInsertRowid?: number | bigint
}

type BunPreparedStatement = {
	all: (...values: Array<unknown>) => Array<Record<string, unknown>>
	run: (...values: Array<unknown>) => BunStatementResult
}

type SqliteCompatPreparedStatement = BunPreparedStatement & { reader: boolean }

type SqliteCompatDatabase = {
	prepare: (text: string) => SqliteCompatPreparedStatement
	exec: (text: string) => void
	pragma: (text: string) => unknown
}

function isReaderStatement(text: string): boolean {
	const normalized = text.trim().toLowerCase()
	if (normalized.startsWith('with')) {
		return !/\b(insert|update|delete|replace)\b/.test(normalized)
	}
	return /^(select|pragma|explain)\b/.test(normalized)
}

function toSqliteCompatDatabase(database: BunDatabase): SqliteCompatDatabase {
	return {
		prepare(text) {
			const statement = database.prepare(
				text,
			) as unknown as BunPreparedStatement
			return {
				reader: isReaderStatement(text),
				all: (...values) => statement.all(...values),
				run: (...values) => statement.run(...values),
			}
		},
		exec(text) {
			database.exec(text)
		},
		pragma(text) {
			return (
				database as unknown as { pragma: (sql: string) => unknown }
			).pragma(text)
		},
	}
}

const sqliteCompat = toSqliteCompatDatabase(sqliteDb)

const sqliteAdapter = createSqliteDatabaseAdapter(
	sqliteCompat as unknown as Parameters<typeof createSqliteDatabaseAdapter>[0],
)

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
