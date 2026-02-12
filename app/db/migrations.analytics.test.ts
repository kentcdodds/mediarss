import { expect, test } from 'bun:test'
import { sql } from './sql.ts'
import { createMigratedTestDatabase } from './test-database.ts'

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
