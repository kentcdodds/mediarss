import { Database } from 'bun:sqlite'
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test'
import fs from 'node:fs'
import { migrate } from './migrations.ts'
import { sql } from './sql.ts'

// Use a separate test database
const TEST_DB_PATH = './data/test-feeds.db'

// We need to mock the db module for testing
let testDb: Database

beforeAll(() => {
	// Ensure clean state
	if (fs.existsSync(TEST_DB_PATH)) {
		fs.unlinkSync(TEST_DB_PATH)
	}

	// Create test database
	testDb = new Database(TEST_DB_PATH)
	migrate(testDb)
})

afterAll(() => {
	testDb.close()
	if (fs.existsSync(TEST_DB_PATH)) {
		fs.unlinkSync(TEST_DB_PATH)
	}
})

beforeEach(() => {
	// Clear tables before each test
	testDb.run(sql`DELETE FROM feed_items`)
	testDb.run(sql`DELETE FROM curated_feed_tokens`)
	testDb.run(sql`DELETE FROM directory_feed_tokens`)
	testDb.run(sql`DELETE FROM curated_feeds`)
	testDb.run(sql`DELETE FROM directory_feeds`)
})

describe('directory_feeds table', () => {
	test('creates a feed with default values', () => {
		testDb.run(sql`
			INSERT INTO directory_feeds (id, name, directory_paths)
			VALUES ('test-1', 'Test Feed', '["audio:/media/audio"]')
		`)

		const feed = testDb
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

	test('creates a feed with all fields', () => {
		testDb.run(sql`
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

		const feed = testDb
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

	test('enforces sort_order check constraint', () => {
		expect(() => {
			testDb.run(sql`
				INSERT INTO directory_feeds (id, name, directory_paths, sort_order)
				VALUES ('test-3', 'Bad Feed', '["audio:/media"]', 'invalid')
			`)
		}).toThrow()
	})
})

describe('curated_feeds table', () => {
	test('creates a feed with default values', () => {
		testDb.run(sql`
			INSERT INTO curated_feeds (id, name)
			VALUES ('test-1', 'Test Curated Feed')
		`)

		const feed = testDb
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

	test('creates a feed with all fields', () => {
		testDb.run(sql`
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

		const feed = testDb
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
		const columns = testDb
			.query(sql`PRAGMA table_info(curated_feeds)`)
			.all() as Array<{ name: string }>
		const columnNames = columns.map((c) => c.name)

		expect(columnNames).not.toContain('filter_in')
		expect(columnNames).not.toContain('filter_out')
	})
})

describe('feed updates', () => {
	test('updates directory feed fields', () => {
		testDb.run(sql`
			INSERT INTO directory_feeds (id, name, directory_paths)
			VALUES ('update-test', 'Original', '["audio:/original/path"]')
		`)

		testDb.run(sql`
			UPDATE directory_feeds
			SET name = 'Updated',
				sort_fields = 'desc:pubDate',
				filter_in = 'Chapter:title',
				image_url = 'https://new-image.com/art.png'
			WHERE id = 'update-test'
		`)

		const feed = testDb
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

	test('can set nullable fields to null', () => {
		testDb.run(sql`
			INSERT INTO directory_feeds (id, name, directory_paths, author, filter_in)
			VALUES ('null-test', 'Test', '["audio:/path"]', 'Some Author', 'Some Filter')
		`)

		testDb.run(sql`
			UPDATE directory_feeds
			SET author = NULL, filter_in = NULL
			WHERE id = 'null-test'
		`)

		const feed = testDb
			.query(sql`SELECT * FROM directory_feeds WHERE id = ?`)
			.get('null-test') as Record<string, unknown>

		expect(feed.author).toBeNull()
		expect(feed.filter_in).toBeNull()
	})
})
