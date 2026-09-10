import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { expect, test } from 'vitest'
import { migrateDatabase, migrationsDirectory } from './migrate.ts'
import { createTestDatabase } from './test-database.ts'

const legacySchemaV8 = readFileSync(
	fileURLToPath(
		new URL('../../test/fixtures/legacy-schema-v8.sql', import.meta.url),
	),
	'utf8',
)

type SchemaRow = { type: string; name: string; sql: string | null }

function normalizeSql(sql: string | null): string | null {
	return (
		sql
			?.replace(/["`]/g, '')
			.replace(/\s+/g, ' ')
			.replace(/\s*([(),])\s*/g, '$1')
			.trim() ?? null
	)
}

/**
 * Snapshot of every application table and index (excluding the migration
 * journal, which only exists after the new runner has run).
 */
function readSchema(sqlite: DatabaseSync): Array<SchemaRow> {
	const rows = sqlite
		.prepare(
			`SELECT type, name, sql FROM sqlite_master
			 WHERE name NOT LIKE 'sqlite_%'
			   AND name NOT IN ('data_table_migrations', 'schema_versions')
			 ORDER BY type, name`,
		)
		.all() as Array<SchemaRow>
	return rows.map((row) => ({ ...row, sql: normalizeSql(row.sql) }))
}

function tableNames(sqlite: DatabaseSync): Array<string> {
	return (
		sqlite
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
			)
			.all() as Array<{ name: string }>
	).map((row) => row.name)
}

/**
 * Opens an in-memory database in the exact state the previous release's
 * hand-rolled runner left it (schema version 8, journaled in `schema_versions`).
 */
function createLegacyV8Database() {
	const sqlite = new DatabaseSync(':memory:')
	sqlite.exec(legacySchemaV8)
	return { sqlite, db: createSqliteDatabase(sqlite) }
}

test('a fresh database gets the baseline schema and a journal entry', async () => {
	using ctx = await createTestDatabase()

	expect(tableNames(ctx.sqlite)).toEqual([
		'authorization_codes',
		'client_metadata_cache',
		'curated_feed_tokens',
		'curated_feeds',
		'data_table_migrations',
		'directory_feed_tokens',
		'directory_feeds',
		'feed_analytics_events',
		'feed_items',
		'oauth_clients',
		'oauth_refresh_tokens',
		'oauth_signing_keys',
	])

	const journal = ctx.sqlite
		.prepare(`SELECT id, name FROM data_table_migrations ORDER BY id`)
		.all()
	expect(journal).toEqual([{ id: '20260910000000', name: 'baseline' }])

	// Running again is a no-op.
	const second = await migrateDatabase(ctx.db)
	expect(second.applied).toEqual([])
})

test('adopts a database created by the legacy migration runner without losing data', async () => {
	const legacy = createLegacyV8Database()
	using _sqlite = legacy.sqlite
	expect(tableNames(legacy.sqlite)).toContain('schema_versions')
	expect(tableNames(legacy.sqlite)).not.toContain('data_table_migrations')

	legacy.sqlite.exec(`
		INSERT INTO directory_feeds (id, name, directory_paths, subtitle, feed_type)
		VALUES ('feed-1', 'Legacy Feed', '["audio:books"]', 'Sub', 'serial');
		INSERT INTO directory_feed_tokens (token, feed_id, label)
		VALUES ('tok-1', 'feed-1', 'Phone');
		INSERT INTO curated_feeds (id, name) VALUES ('cur-1', 'Curated');
		INSERT INTO feed_items (id, feed_id, media_root, relative_path, position)
		VALUES ('item-1', 'cur-1', 'audio', 'a.mp3', 1);
		INSERT INTO oauth_clients (id, name, redirect_uris)
		VALUES ('client-1', 'Client', '["https://example.com/cb"]');
		INSERT INTO oauth_refresh_tokens (token, family_id, client_id, expires_at)
		VALUES ('rt-1', 'fam-1', 'client-1', 4102444800);
		INSERT INTO feed_analytics_events (id, event_type, feed_id, feed_type, token, status_code)
		VALUES ('evt-1', 'rss_fetch', 'feed-1', 'directory', 'tok-1', 200);
	`)

	const result = await migrateDatabase(legacy.db)
	expect(result.applied.map((m) => m.name)).toEqual(['baseline'])

	// The new journal records the baseline; the legacy journal survives untouched
	// so the previous release can still start against this database (it sees
	// version 8 and skips its own migrations).
	expect(
		legacy.sqlite.prepare(`SELECT id, name FROM data_table_migrations`).all(),
	).toEqual([{ id: '20260910000000', name: 'baseline' }])
	expect(tableNames(legacy.sqlite)).toContain('schema_versions')
	expect(
		legacy.sqlite
			.prepare(`SELECT MAX(version) AS version FROM schema_versions`)
			.get(),
	).toEqual({ version: 8 })

	// Data survived.
	expect(
		legacy.sqlite
			.prepare(`SELECT id, name, subtitle, feed_type FROM directory_feeds`)
			.all(),
	).toEqual([
		{ id: 'feed-1', name: 'Legacy Feed', subtitle: 'Sub', feed_type: 'serial' },
	])
	expect(
		legacy.sqlite
			.prepare(`SELECT token, feed_id FROM directory_feed_tokens`)
			.all(),
	).toEqual([{ token: 'tok-1', feed_id: 'feed-1' }])
	expect(legacy.sqlite.prepare(`SELECT id FROM feed_items`).all()).toEqual([
		{ id: 'item-1' },
	])
	expect(
		legacy.sqlite.prepare(`SELECT token FROM oauth_refresh_tokens`).all(),
	).toEqual([{ token: 'rt-1' }])
	expect(
		legacy.sqlite.prepare(`SELECT id FROM feed_analytics_events`).all(),
	).toEqual([{ id: 'evt-1' }])

	// The adopted schema is identical to what the baseline creates from scratch.
	using fresh = await createTestDatabase()
	expect(readSchema(legacy.sqlite)).toEqual(readSchema(fresh.sqlite))

	// And re-running is a no-op.
	expect((await migrateDatabase(legacy.db)).applied).toEqual([])
})

test('refuses to adopt a legacy database older than schema version 8', async () => {
	const legacy = createLegacyV8Database()
	using _sqlite = legacy.sqlite
	legacy.sqlite.exec(`DELETE FROM schema_versions WHERE version = 8`)

	await expect(migrateDatabase(legacy.db)).rejects.toThrow(
		/schema version 7 is older than the supported baseline/,
	)
	expect(tableNames(legacy.sqlite)).toContain('schema_versions')
	expect(tableNames(legacy.sqlite)).not.toContain('data_table_migrations')
})

test('rolling back the baseline drops every application table', async () => {
	using ctx = await createTestDatabase()
	const migrations = await loadMigrations(migrationsDirectory)

	const result = await ctx.db.migrate(migrations, {
		direction: 'down',
		step: 1,
	})
	expect(result.reverted.map((m) => m.name)).toEqual(['baseline'])
	expect(tableNames(ctx.sqlite)).toEqual(['data_table_migrations'])

	const status = await ctx.db.migrationStatus(migrations)
	expect(status.map((m) => [m.name, m.status])).toEqual([
		['baseline', 'pending'],
	])

	await migrateDatabase(ctx.db)
	expect(tableNames(ctx.sqlite)).toContain('directory_feeds')
})

test('authorization_codes does not foreign-key oauth_clients', async () => {
	using ctx = await createTestDatabase()

	const foreignKeys = ctx.sqlite
		.prepare(`PRAGMA foreign_key_list(authorization_codes);`)
		.all()
	expect(foreignKeys).toEqual([])

	ctx.sqlite.exec(`
		INSERT INTO authorization_codes (
			code, client_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at
		) VALUES (
			'code-cimd', 'https://example.com/oauth/client-metadata.json',
			'https://example.com/callback', 'mcp:read', 'challenge', 'S256', 9999999999
		);
	`)

	const row = ctx.sqlite
		.prepare(
			`SELECT client_id FROM authorization_codes WHERE code = 'code-cimd';`,
		)
		.get() as { client_id: string }
	expect(row.client_id).toBe('https://example.com/oauth/client-metadata.json')

	const indexes = ctx.sqlite
		.prepare(`PRAGMA index_list(authorization_codes);`)
		.all() as Array<{ name: string }>
	const indexNames = indexes.map((index) => index.name)
	expect(indexNames).toContain('idx_authorization_codes_client_id')
	expect(indexNames).toContain('idx_authorization_codes_expires_at')
})

test('oauth_refresh_tokens table has the expected columns and indexes', async () => {
	using ctx = await createTestDatabase()

	const columns = ctx.sqlite
		.prepare(`PRAGMA table_info(oauth_refresh_tokens);`)
		.all() as Array<{ name: string }>
	expect(columns.map((column) => column.name)).toEqual([
		'token',
		'family_id',
		'client_id',
		'scope',
		'expires_at',
		'used_at',
		'created_at',
	])

	const indexes = ctx.sqlite
		.prepare(`PRAGMA index_list(oauth_refresh_tokens);`)
		.all() as Array<{ name: string }>
	const indexNames = indexes.map((index) => index.name)
	expect(indexNames).toContain('idx_oauth_refresh_tokens_client_id')
	expect(indexNames).toContain('idx_oauth_refresh_tokens_family_id')
	expect(indexNames).toContain('idx_oauth_refresh_tokens_expires_at')
})

test('feed_analytics_events table has the expected columns and indexes', async () => {
	using ctx = await createTestDatabase()

	const columns = ctx.sqlite
		.prepare(`PRAGMA table_info(feed_analytics_events);`)
		.all() as Array<{ name: string }>
	expect(columns.map((column) => column.name)).toEqual([
		'id',
		'event_type',
		'feed_id',
		'feed_type',
		'token',
		'media_root',
		'relative_path',
		'is_download_start',
		'bytes_served',
		'status_code',
		'client_fingerprint',
		'client_name',
		'created_at',
	])

	const indexes = ctx.sqlite
		.prepare(`PRAGMA index_list(feed_analytics_events);`)
		.all() as Array<{ name: string }>
	const indexNames = indexes.map((index) => index.name)
	expect(indexNames).toContain('idx_feed_analytics_events_feed_id_created_at')
	expect(indexNames).toContain('idx_feed_analytics_events_token_created_at')
	expect(indexNames).toContain(
		'idx_feed_analytics_events_media_path_created_at',
	)
	expect(indexNames).toContain(
		'idx_feed_analytics_events_event_type_created_at',
	)
})

test('analytics table enforces event_type and feed_type constraints', async () => {
	using ctx = await createTestDatabase()

	const insert = (id: string, eventType: string, feedType: string) =>
		ctx.sqlite
			.prepare(
				`INSERT INTO feed_analytics_events (id, event_type, feed_id, feed_type, token, status_code, created_at)
				 VALUES (?, ?, 'feed_1', ?, 'token_1', 200, 1700000000)`,
			)
			.run(id, eventType, feedType)

	insert('evt_1', 'rss_fetch', 'directory')
	const count = ctx.sqlite
		.prepare(`SELECT COUNT(*) AS count FROM feed_analytics_events;`)
		.get() as { count: number }
	expect(count.count).toBe(1)

	expect(() => insert('evt_bad_event', 'unknown_event', 'directory')).toThrow(
		/CHECK constraint failed/,
	)
	expect(() =>
		insert('evt_bad_feed_type', 'rss_fetch', 'unknown_feed_type'),
	).toThrow(/CHECK constraint failed/)
})
