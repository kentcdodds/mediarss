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
					directory_paths TEXT NOT NULL,
					sort_fields TEXT NOT NULL DEFAULT 'filename',
					sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
					image_url TEXT,
					author TEXT,
					owner_name TEXT,
					owner_email TEXT,
					language TEXT NOT NULL DEFAULT 'en',
					explicit TEXT NOT NULL DEFAULT 'no',
					category TEXT,
					link TEXT,
					filter_in TEXT,
					filter_out TEXT,
					overrides TEXT,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)

			db.run(sql`
				CREATE TABLE IF NOT EXISTS directory_feed_tokens (
					token TEXT PRIMARY KEY,
					feed_id TEXT NOT NULL REFERENCES directory_feeds(id) ON DELETE CASCADE,
					label TEXT NOT NULL DEFAULT '',
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					last_used_at INTEGER,
					revoked_at INTEGER
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_directory_feed_tokens_feed_id ON directory_feed_tokens(feed_id);
			`)

			// CuratedFeed table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS curated_feeds (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					description TEXT NOT NULL DEFAULT '',
					sort_fields TEXT NOT NULL DEFAULT 'position',
					sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
					image_url TEXT,
					author TEXT,
					owner_name TEXT,
					owner_email TEXT,
					language TEXT NOT NULL DEFAULT 'en',
					explicit TEXT NOT NULL DEFAULT 'no',
					category TEXT,
					link TEXT,
					overrides TEXT,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)

			db.run(sql`
				CREATE TABLE IF NOT EXISTS curated_feed_tokens (
					token TEXT PRIMARY KEY,
					feed_id TEXT NOT NULL REFERENCES curated_feeds(id) ON DELETE CASCADE,
					label TEXT NOT NULL DEFAULT '',
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					last_used_at INTEGER,
					revoked_at INTEGER
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_curated_feed_tokens_feed_id ON curated_feed_tokens(feed_id);
			`)

			// FeedItem table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS feed_items (
					id TEXT PRIMARY KEY,
					feed_id TEXT NOT NULL REFERENCES curated_feeds(id) ON DELETE CASCADE,
					media_root TEXT NOT NULL,
					relative_path TEXT NOT NULL,
					position REAL,
					added_at INTEGER NOT NULL DEFAULT (unixepoch()),
					UNIQUE(feed_id, media_root, relative_path)
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id ON feed_items(feed_id);
			`)
		},
	},
	{
		version: 2,
		name: 'add_feed_properties',
		up: (db) => {
			// Add subtitle and copyright columns (nullable)
			db.run(sql`ALTER TABLE directory_feeds ADD COLUMN subtitle TEXT;`)
			db.run(sql`ALTER TABLE directory_feeds ADD COLUMN copyright TEXT;`)
			db.run(sql`ALTER TABLE curated_feeds ADD COLUMN subtitle TEXT;`)
			db.run(sql`ALTER TABLE curated_feeds ADD COLUMN copyright TEXT;`)

			// Add feed_type column as nullable first (to handle existing data)
			db.run(
				sql`ALTER TABLE directory_feeds ADD COLUMN feed_type TEXT CHECK (feed_type IN ('episodic', 'serial'));`,
			)
			db.run(
				sql`ALTER TABLE curated_feeds ADD COLUMN feed_type TEXT CHECK (feed_type IN ('episodic', 'serial'));`,
			)

			// Set default value for existing rows
			db.run(
				sql`UPDATE directory_feeds SET feed_type = 'episodic' WHERE feed_type IS NULL;`,
			)
			db.run(
				sql`UPDATE curated_feeds SET feed_type = 'episodic' WHERE feed_type IS NULL;`,
			)

			// Note: SQLite doesn't support ALTER COLUMN to add NOT NULL constraint
			// after column creation without recreating the table.
			// The application layer enforces the default value of 'episodic'.
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
