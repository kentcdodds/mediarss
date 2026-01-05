import type { Database } from 'bun:sqlite'
import { sql } from './sql.ts'

type Migration = {
	version: number
	name: string
	up: (db: Database) => void
}

const migrations: Array<Migration> = [
	{
		version: 1,
		name: 'initial_schema',
		up: (db) => {
			// DirectoryFeed table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS directory_feeds (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					description TEXT NOT NULL DEFAULT '',
					token TEXT NOT NULL UNIQUE,
					directory_path TEXT NOT NULL,
					sort_by TEXT NOT NULL DEFAULT 'filename',
					sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_directory_feeds_token ON directory_feeds(token);
			`)

			// CuratedFeed table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS curated_feeds (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					description TEXT NOT NULL DEFAULT '',
					token TEXT NOT NULL UNIQUE,
					sort_by TEXT NOT NULL DEFAULT 'position',
					sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_curated_feeds_token ON curated_feeds(token);
			`)

			// FeedItem table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS feed_items (
					id TEXT PRIMARY KEY,
					feed_id TEXT NOT NULL REFERENCES curated_feeds(id) ON DELETE CASCADE,
					file_path TEXT NOT NULL,
					position INTEGER,
					added_at INTEGER NOT NULL DEFAULT (unixepoch()),
					UNIQUE(feed_id, file_path)
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id ON feed_items(feed_id);
			`)
		},
	},
]

/**
 * Run all pending migrations
 */
export function migrate(db: Database): void {
	// Create schema_versions table if it doesn't exist
	db.run(sql`
		CREATE TABLE IF NOT EXISTS schema_versions (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at INTEGER NOT NULL DEFAULT (unixepoch())
		);
	`)

	// Get the current version
	const result = db
		.query<{ version: number | null }, []>(
			sql`SELECT MAX(version) as version FROM schema_versions;`,
		)
		.get()

	const currentVersion = result?.version ?? 0
	let migrationCount = 0

	// Run any migrations that haven't been applied yet
	for (const migration of migrations) {
		if (migration.version > currentVersion) {
			console.log(`Running migration ${migration.version}: ${migration.name}`)
			migration.up(db)
			db.query(
				sql`INSERT INTO schema_versions (version, name) VALUES (?, ?);`,
			).run(migration.version, migration.name)
			console.log(`Completed migration ${migration.version}`)
			migrationCount++
		}
	}

	if (migrationCount > 0) {
		console.log(
			`Migration process completed. ${migrationCount} migration(s) applied.`,
		)
	}
}
