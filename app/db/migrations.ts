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
			// Add subtitle, copyright, and feed_type columns (all nullable)
			// feed_type defaults to 'episodic' at the application layer when null
			db.run(sql`ALTER TABLE directory_feeds ADD COLUMN subtitle TEXT;`)
			db.run(sql`ALTER TABLE directory_feeds ADD COLUMN copyright TEXT;`)
			db.run(
				sql`ALTER TABLE directory_feeds ADD COLUMN feed_type TEXT CHECK (feed_type IN ('episodic', 'serial'));`,
			)

			db.run(sql`ALTER TABLE curated_feeds ADD COLUMN subtitle TEXT;`)
			db.run(sql`ALTER TABLE curated_feeds ADD COLUMN copyright TEXT;`)
			db.run(
				sql`ALTER TABLE curated_feeds ADD COLUMN feed_type TEXT CHECK (feed_type IN ('episodic', 'serial'));`,
			)
		},
	},
	{
		version: 3,
		name: 'add_oauth_tables',
		up: (db) => {
			// OAuth clients table
			db.run(sql`
				CREATE TABLE IF NOT EXISTS oauth_clients (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					redirect_uris TEXT NOT NULL,
					created_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)

			// Authorization codes table (short-lived, single-use)
			db.run(sql`
				CREATE TABLE IF NOT EXISTS authorization_codes (
					code TEXT PRIMARY KEY,
					client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
					redirect_uri TEXT NOT NULL,
					scope TEXT NOT NULL DEFAULT '',
					code_challenge TEXT NOT NULL,
					code_challenge_method TEXT NOT NULL DEFAULT 'S256',
					expires_at INTEGER NOT NULL,
					used_at INTEGER,
					created_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_authorization_codes_client_id ON authorization_codes(client_id);
			`)
			db.run(sql`
				CREATE INDEX IF NOT EXISTS idx_authorization_codes_expires_at ON authorization_codes(expires_at);
			`)

			// OAuth signing keys table (stores RS256 keypair)
			db.run(sql`
				CREATE TABLE IF NOT EXISTS oauth_signing_keys (
					id TEXT PRIMARY KEY,
					public_key_jwk TEXT NOT NULL,
					private_key_jwk TEXT NOT NULL,
					created_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
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
