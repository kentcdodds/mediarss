import { expect, test } from 'vitest'
import { createTestDatabase } from './test-database.ts'

test('directory_feeds table stores feeds with all fields and enforces constraints', async () => {
	using ctx = await createTestDatabase()

	// Test creating a feed with minimal required fields and defaults
	ctx.sqlite.exec(`
		INSERT INTO directory_feeds (id, name, directory_paths)
		VALUES ('test-1', 'Test Feed', '["audio:/media/audio"]')
	`)

	const minimalFeed = ctx.sqlite
		.prepare(`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('test-1') as Record<string, unknown>

	expect(minimalFeed.name).toBe('Test Feed')
	expect(minimalFeed.description).toBe('')
	expect(minimalFeed.directory_paths).toBe('["audio:/media/audio"]')
	expect(minimalFeed.sort_fields).toBe('filename')
	expect(minimalFeed.sort_order).toBe('asc')
	expect(minimalFeed.language).toBe('en')
	expect(minimalFeed.explicit).toBe('no')
	expect(minimalFeed.author).toBeNull()
	expect(minimalFeed.owner_name).toBeNull()
	expect(minimalFeed.owner_email).toBeNull()
	expect(minimalFeed.category).toBeNull()
	expect(minimalFeed.link).toBeNull()
	expect(minimalFeed.filter_in).toBeNull()
	expect(minimalFeed.filter_out).toBeNull()
	expect(minimalFeed.overrides).toBeNull()

	// Test creating a feed with all fields specified
	ctx.sqlite.exec(`
		INSERT INTO directory_feeds (
			id, name, description, directory_paths, sort_fields, sort_order,
			author, owner_name, owner_email, language, explicit,
			category, link, filter_in, filter_out, overrides
		)
		VALUES (
			'test-2', 'Full Feed', 'A description', '["video:/media/video","audio:/media/audio"]',
			'desc:pubDate,asc:title', 'desc',
			'John Doe', 'Jane Doe', 'jane@example.com',
			'en-US', 'clean', 'Arts > Books', 'https://example.com',
			'Season 1:title', 'Trailer:title', '{"custom": "value"}'
		)
	`)

	const fullFeed = ctx.sqlite
		.prepare(`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('test-2') as Record<string, unknown>

	expect(fullFeed.name).toBe('Full Feed')
	expect(fullFeed.description).toBe('A description')
	expect(fullFeed.directory_paths).toBe(
		'["video:/media/video","audio:/media/audio"]',
	)
	expect(fullFeed.sort_fields).toBe('desc:pubDate,asc:title')
	expect(fullFeed.sort_order).toBe('desc')
	expect(fullFeed.author).toBe('John Doe')
	expect(fullFeed.owner_name).toBe('Jane Doe')
	expect(fullFeed.owner_email).toBe('jane@example.com')
	expect(fullFeed.language).toBe('en-US')
	expect(fullFeed.explicit).toBe('clean')
	expect(fullFeed.category).toBe('Arts > Books')
	expect(fullFeed.link).toBe('https://example.com')
	expect(fullFeed.filter_in).toBe('Season 1:title')
	expect(fullFeed.filter_out).toBe('Trailer:title')
	expect(fullFeed.overrides).toBe('{"custom": "value"}')

	// Test sort_order check constraint
	expect(() => {
		ctx.sqlite.exec(`
			INSERT INTO directory_feeds (id, name, directory_paths, sort_order)
			VALUES ('test-3', 'Bad Feed', '["audio:/media"]', 'invalid')
		`)
	}).toThrow(/CHECK constraint failed/)
})

test('curated_feeds table stores feeds with all fields and correct schema', async () => {
	using ctx = await createTestDatabase()

	// Test creating a feed with minimal required fields and defaults
	ctx.sqlite.exec(`
		INSERT INTO curated_feeds (id, name)
		VALUES ('test-1', 'Test Curated Feed')
	`)

	const minimalFeed = ctx.sqlite
		.prepare(`SELECT * FROM curated_feeds WHERE id = ?`)
		.get('test-1') as Record<string, unknown>

	expect(minimalFeed.name).toBe('Test Curated Feed')
	expect(minimalFeed.description).toBe('')
	expect(minimalFeed.sort_fields).toBe('position')
	expect(minimalFeed.sort_order).toBe('asc')
	expect(minimalFeed.language).toBe('en')
	expect(minimalFeed.explicit).toBe('no')
	expect(minimalFeed.author).toBeNull()
	expect(minimalFeed.owner_name).toBeNull()
	expect(minimalFeed.owner_email).toBeNull()
	expect(minimalFeed.category).toBeNull()
	expect(minimalFeed.link).toBeNull()
	expect(minimalFeed.overrides).toBeNull()

	// Test creating a feed with all fields specified
	ctx.sqlite.exec(`
		INSERT INTO curated_feeds (
			id, name, description, sort_fields, sort_order,
			author, owner_name, owner_email, language, explicit,
			category, link, overrides
		)
		VALUES (
			'test-2', 'Full Curated Feed', 'A curated description',
			'asc:position,desc:addedAt', 'asc',
			'Curator', 'Owner Name', 'owner@example.com',
			'es', 'yes', 'Comedy', 'https://curated.example.com',
			'{"rss": {"channel": {"custom": true}}}'
		)
	`)

	const fullFeed = ctx.sqlite
		.prepare(`SELECT * FROM curated_feeds WHERE id = ?`)
		.get('test-2') as Record<string, unknown>

	expect(fullFeed.name).toBe('Full Curated Feed')
	expect(fullFeed.description).toBe('A curated description')
	expect(fullFeed.sort_fields).toBe('asc:position,desc:addedAt')
	expect(fullFeed.author).toBe('Curator')
	expect(fullFeed.owner_name).toBe('Owner Name')
	expect(fullFeed.owner_email).toBe('owner@example.com')
	expect(fullFeed.language).toBe('es')
	expect(fullFeed.explicit).toBe('yes')
	expect(fullFeed.category).toBe('Comedy')
	expect(fullFeed.link).toBe('https://curated.example.com')
	expect(fullFeed.overrides).toBe('{"rss": {"channel": {"custom": true}}}')

	// Verify curated_feeds does NOT have filter_in/filter_out columns
	const columns = ctx.sqlite
		.prepare(`PRAGMA table_info(curated_feeds)`)
		.all() as Array<{ name: string }>
	const columnNames = columns.map((c) => c.name)

	expect(columnNames).not.toContain('filter_in')
	expect(columnNames).not.toContain('filter_out')
})

test('directory_feeds supports updating fields and setting nullable fields to null', async () => {
	using ctx = await createTestDatabase()

	// Create a feed to update
	ctx.sqlite.exec(`
		INSERT INTO directory_feeds (id, name, directory_paths, author, filter_in)
		VALUES ('update-test', 'Original', '["audio:/original/path"]', 'Some Author', 'Some Filter')
	`)

	// Update some fields
	ctx.sqlite.exec(`
		UPDATE directory_feeds
		SET name = 'Updated',
			sort_fields = 'desc:pubDate',
			filter_in = 'Chapter:title'
		WHERE id = 'update-test'
	`)

	const updatedFeed = ctx.sqlite
		.prepare(`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('update-test') as Record<string, unknown>

	expect(updatedFeed.name).toBe('Updated')
	expect(updatedFeed.sort_fields).toBe('desc:pubDate')
	expect(updatedFeed.filter_in).toBe('Chapter:title')
	// Unchanged fields should remain
	expect(updatedFeed.directory_paths).toBe('["audio:/original/path"]')
	expect(updatedFeed.language).toBe('en')

	// Set nullable fields to null
	ctx.sqlite.exec(`
		UPDATE directory_feeds
		SET author = NULL, filter_in = NULL
		WHERE id = 'update-test'
	`)

	const nulledFeed = ctx.sqlite
		.prepare(`SELECT * FROM directory_feeds WHERE id = ?`)
		.get('update-test') as Record<string, unknown>

	expect(nulledFeed.author).toBeNull()
	expect(nulledFeed.filter_in).toBeNull()
})
