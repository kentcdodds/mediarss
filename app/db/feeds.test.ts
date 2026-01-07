import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { migrate } from './migrations.ts'
import { sql } from './sql.ts'

/**
 * Creates a test database that will be automatically closed and deleted.
 */
function createTestDatabase() {
	const dbPath = `./data/test-feeds-${Date.now()}-${Math.random().toString(36).slice(2)}.db`

	// Ensure data directory exists
	const dir = path.dirname(dbPath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}

	const db = new Database(dbPath)
	migrate(db)

	return {
		db,
		[Symbol.dispose]: () => {
			db.close()
			if (fs.existsSync(dbPath)) {
				fs.unlinkSync(dbPath)
			}
		},
	}
}

// directory_feeds table tests

test('directory_feeds creates a feed with default values', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO directory_feeds (id, name, directory_paths)
		VALUES ('test-1', 'Test Feed', '["audio:/media/audio"]')
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('test-1') as Record<string, unknown>

	expect(feed.name).toBe('Test Feed')
	expect(feed.description).toBe('')
	expect(feed.directory_paths).toBe('["audio:/media/audio"]')
	expect(feed.sort_fields).toBe('filename')
	expect(feed.sort_order).toBe('asc')
	expect(feed.language).toBe('en')
	expect(feed.explicit).toBe('no')
	expect(feed.image_url).toBeNull()
	expect(feed.author).toBeNull()
	expect(feed.owner_name).toBeNull()
	expect(feed.owner_email).toBeNull()
	expect(feed.category).toBeNull()
	expect(feed.link).toBeNull()
	expect(feed.filter_in).toBeNull()
	expect(feed.filter_out).toBeNull()
	expect(feed.overrides).toBeNull()
})

test('directory_feeds creates a feed with all fields', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO directory_feeds (
			id, name, description, directory_paths, sort_fields, sort_order,
			image_url, author, owner_name, owner_email, language, explicit,
			category, link, filter_in, filter_out, overrides
		)
		VALUES (
			'test-2', 'Full Feed', 'A description', '["video:/media/video","audio:/media/audio"]',
			'desc:pubDate,asc:title', 'desc',
			'https://example.com/image.png', 'John Doe', 'Jane Doe', 'jane@example.com',
			'en-US', 'clean', 'Arts > Books', 'https://example.com',
			'Season 1:title', 'Trailer:title', '{"custom": "value"}'
		)
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('test-2') as Record<string, unknown>

	expect(feed.name).toBe('Full Feed')
	expect(feed.description).toBe('A description')
	expect(feed.directory_paths).toBe(
		'["video:/media/video","audio:/media/audio"]',
	)
	expect(feed.sort_fields).toBe('desc:pubDate,asc:title')
	expect(feed.sort_order).toBe('desc')
	expect(feed.image_url).toBe('https://example.com/image.png')
	expect(feed.author).toBe('John Doe')
	expect(feed.owner_name).toBe('Jane Doe')
	expect(feed.owner_email).toBe('jane@example.com')
	expect(feed.language).toBe('en-US')
	expect(feed.explicit).toBe('clean')
	expect(feed.category).toBe('Arts > Books')
	expect(feed.link).toBe('https://example.com')
	expect(feed.filter_in).toBe('Season 1:title')
	expect(feed.filter_out).toBe('Trailer:title')
	expect(feed.overrides).toBe('{"custom": "value"}')
})

test('directory_feeds enforces sort_order check constraint', () => {
	using ctx = createTestDatabase()

	expect(() => {
		ctx.db.run(sql`
			INSERT INTO directory_feeds (id, name, directory_paths, sort_order)
			VALUES ('test-3', 'Bad Feed', '["audio:/media"]', 'invalid')
		`)
	}).toThrow()
})

// curated_feeds table tests

test('curated_feeds creates a feed with default values', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO curated_feeds (id, name)
		VALUES ('test-1', 'Test Curated Feed')
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM curated_feeds WHERE id = ?`)
		.get('test-1') as Record<string, unknown>

	expect(feed.name).toBe('Test Curated Feed')
	expect(feed.description).toBe('')
	expect(feed.sort_fields).toBe('position')
	expect(feed.sort_order).toBe('asc')
	expect(feed.language).toBe('en')
	expect(feed.explicit).toBe('no')
	expect(feed.image_url).toBeNull()
	expect(feed.author).toBeNull()
	expect(feed.owner_name).toBeNull()
	expect(feed.owner_email).toBeNull()
	expect(feed.category).toBeNull()
	expect(feed.link).toBeNull()
	expect(feed.overrides).toBeNull()
})

test('curated_feeds creates a feed with all fields', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO curated_feeds (
			id, name, description, sort_fields, sort_order,
			image_url, author, owner_name, owner_email, language, explicit,
			category, link, overrides
		)
		VALUES (
			'test-2', 'Full Curated Feed', 'A curated description',
			'asc:position,desc:addedAt', 'asc',
			'https://example.com/curated.png', 'Curator', 'Owner Name', 'owner@example.com',
			'es', 'yes', 'Comedy', 'https://curated.example.com',
			'{"rss": {"channel": {"custom": true}}}'
		)
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM curated_feeds WHERE id = ?`)
		.get('test-2') as Record<string, unknown>

	expect(feed.name).toBe('Full Curated Feed')
	expect(feed.description).toBe('A curated description')
	expect(feed.sort_fields).toBe('asc:position,desc:addedAt')
	expect(feed.image_url).toBe('https://example.com/curated.png')
	expect(feed.author).toBe('Curator')
	expect(feed.owner_name).toBe('Owner Name')
	expect(feed.owner_email).toBe('owner@example.com')
	expect(feed.language).toBe('es')
	expect(feed.explicit).toBe('yes')
	expect(feed.category).toBe('Comedy')
	expect(feed.link).toBe('https://curated.example.com')
	expect(feed.overrides).toBe('{"rss": {"channel": {"custom": true}}}')
})

test('curated_feeds does not have filter_in/filter_out columns', () => {
	using ctx = createTestDatabase()

	const columns = ctx.db
		.query(sql`PRAGMA table_info(curated_feeds)`)
		.all() as Array<{ name: string }>
	const columnNames = columns.map((c) => c.name)

	expect(columnNames).not.toContain('filter_in')
	expect(columnNames).not.toContain('filter_out')
})

// feed update tests

test('directory_feeds updates feed fields', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO directory_feeds (id, name, directory_paths)
		VALUES ('update-test', 'Original', '["audio:/original/path"]')
	`)

	ctx.db.run(sql`
		UPDATE directory_feeds
		SET name = 'Updated',
			sort_fields = 'desc:pubDate',
			filter_in = 'Chapter:title',
			image_url = 'https://new-image.com/art.png'
		WHERE id = 'update-test'
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('update-test') as Record<string, unknown>

	expect(feed.name).toBe('Updated')
	expect(feed.sort_fields).toBe('desc:pubDate')
	expect(feed.filter_in).toBe('Chapter:title')
	expect(feed.image_url).toBe('https://new-image.com/art.png')
	// Unchanged fields
	expect(feed.directory_paths).toBe('["audio:/original/path"]')
	expect(feed.language).toBe('en')
})

test('directory_feeds can set nullable fields to null', () => {
	using ctx = createTestDatabase()

	ctx.db.run(sql`
		INSERT INTO directory_feeds (id, name, directory_paths, author, filter_in)
		VALUES ('null-test', 'Test', '["audio:/path"]', 'Some Author', 'Some Filter')
	`)

	ctx.db.run(sql`
		UPDATE directory_feeds
		SET author = NULL, filter_in = NULL
		WHERE id = 'null-test'
	`)

	const feed = ctx.db
		.query(sql`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('null-test') as Record<string, unknown>

	expect(feed.author).toBeNull()
	expect(feed.filter_in).toBeNull()
})
