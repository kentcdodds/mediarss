import { expect, test } from 'vitest'
import { migrate } from './migrations.ts'
import { sql } from './sql.ts'
import { createMigratedTestDatabase } from './test-database.ts'

test('authorization_codes does not foreign-key oauth_clients', () => {
	using ctx = createMigratedTestDatabase('test-auth-codes-fk')

	const foreignKeys = ctx.db
		.query(sql`PRAGMA foreign_key_list(authorization_codes);`)
		.all() as Array<{ table: string }>

	expect(foreignKeys).toEqual([])

	ctx.db.run(sql`
		INSERT INTO authorization_codes (
			code,
			client_id,
			redirect_uri,
			scope,
			code_challenge,
			code_challenge_method,
			expires_at
		) VALUES (
			'code-cimd',
			'https://example.com/oauth/client-metadata.json',
			'https://example.com/callback',
			'mcp:read',
			'challenge',
			'S256',
			9999999999
		);
	`)

	const row = ctx.db
		.query<{ client_id: string }, []>(
			sql`SELECT client_id FROM authorization_codes WHERE code = 'code-cimd';`,
		)
		.get()
	expect(row?.client_id).toBe('https://example.com/oauth/client-metadata.json')
})

test('migration 8 copies existing authorization codes and drops the client FK', () => {
	using ctx = createMigratedTestDatabase('test-auth-codes-migrate', 7)

	const foreignKeysBefore = ctx.db
		.query(sql`PRAGMA foreign_key_list(authorization_codes);`)
		.all() as Array<{ table: string }>
	expect(foreignKeysBefore.map((key) => key.table)).toContain('oauth_clients')

	ctx.db.run(sql`
		INSERT INTO oauth_clients (id, name, redirect_uris, created_at)
		VALUES (
			'client-static',
			'Static Client',
			'["https://example.com/callback"]',
			1700000000
		);
	`)
	ctx.db.run(sql`
		INSERT INTO authorization_codes (
			code,
			client_id,
			redirect_uri,
			scope,
			code_challenge,
			code_challenge_method,
			expires_at,
			used_at,
			created_at
		) VALUES (
			'code-keep',
			'client-static',
			'https://example.com/callback',
			'mcp:read mcp:write',
			'challenge-value',
			'S256',
			1800000000,
			1700000100,
			1700000001
		);
	`)

	migrate(ctx.db, 8)

	const row = ctx.db
		.query<
			{
				code: string
				client_id: string
				redirect_uri: string
				scope: string
				code_challenge: string
				code_challenge_method: string
				expires_at: number
				used_at: number | null
				created_at: number
			},
			[]
		>(sql`SELECT * FROM authorization_codes WHERE code = 'code-keep';`)
		.get()
	expect(row).toEqual({
		code: 'code-keep',
		client_id: 'client-static',
		redirect_uri: 'https://example.com/callback',
		scope: 'mcp:read mcp:write',
		code_challenge: 'challenge-value',
		code_challenge_method: 'S256',
		expires_at: 1800000000,
		used_at: 1700000100,
		created_at: 1700000001,
	})

	const foreignKeysAfter = ctx.db
		.query(sql`PRAGMA foreign_key_list(authorization_codes);`)
		.all() as Array<{ table: string }>
	expect(foreignKeysAfter).toEqual([])

	const indexes = ctx.db
		.query(sql`PRAGMA index_list(authorization_codes);`)
		.all() as Array<{ name: string }>
	const indexNames = indexes.map((index) => index.name)
	expect(indexNames).toContain('idx_authorization_codes_client_id')
	expect(indexNames).toContain('idx_authorization_codes_expires_at')
})

test('migration creates oauth_refresh_tokens table and indexes', () => {
	using ctx = createMigratedTestDatabase('test-refresh-tokens')

	const columns = ctx.db
		.query(sql`PRAGMA table_info(oauth_refresh_tokens);`)
		.all() as Array<{ name: string }>
	const columnNames = columns.map((column) => column.name)

	expect(columnNames).toEqual([
		'token',
		'family_id',
		'client_id',
		'scope',
		'expires_at',
		'used_at',
		'created_at',
	])

	const indexes = ctx.db
		.query(sql`PRAGMA index_list(oauth_refresh_tokens);`)
		.all() as Array<{ name: string }>
	const indexNames = indexes.map((index) => index.name)

	expect(indexNames).toContain('idx_oauth_refresh_tokens_client_id')
	expect(indexNames).toContain('idx_oauth_refresh_tokens_family_id')
	expect(indexNames).toContain('idx_oauth_refresh_tokens_expires_at')
})

test('migration creates feed_analytics_events table and indexes', () => {
	using ctx = createMigratedTestDatabase('test-analytics')

	const columns = ctx.db
		.query(sql`PRAGMA table_info(feed_analytics_events);`)
		.all() as Array<{ name: string }>
	const columnNames = columns.map((column) => column.name)

	expect(columnNames).toEqual([
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

	const indexes = ctx.db
		.query(sql`PRAGMA index_list(feed_analytics_events);`)
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

test('analytics table enforces event_type and feed_type constraints', () => {
	using ctx = createMigratedTestDatabase('test-analytics')

	ctx.db.run(sql`
		INSERT INTO feed_analytics_events (
			id,
			event_type,
			feed_id,
			feed_type,
			token,
			status_code,
			created_at
		)
		VALUES (
			'evt_1',
			'rss_fetch',
			'feed_1',
			'directory',
			'token_1',
			200,
			1700000000
		);
	`)

	const validEventCount = ctx.db
		.query(sql`SELECT COUNT(*) AS count FROM feed_analytics_events;`)
		.get() as { count: number }
	expect(validEventCount.count).toBe(1)

	expect(() => {
		ctx.db.run(sql`
			INSERT INTO feed_analytics_events (
				id,
				event_type,
				feed_id,
				feed_type,
				token,
				status_code,
				created_at
			)
			VALUES (
				'evt_bad_event',
				'unknown_event',
				'feed_1',
				'directory',
				'token_1',
				200,
				1700000001
			);
		`)
	}).toThrow()

	expect(() => {
		ctx.db.run(sql`
			INSERT INTO feed_analytics_events (
				id,
				event_type,
				feed_id,
				feed_type,
				token,
				status_code,
				created_at
			)
			VALUES (
				'evt_bad_feed_type',
				'rss_fetch',
				'feed_1',
				'unknown_feed_type',
				'token_1',
				200,
				1700000002
			);
		`)
	}).toThrow()
})
