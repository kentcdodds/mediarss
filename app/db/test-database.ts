import { DatabaseSync } from 'node:sqlite'
import {
	createSqliteDatabase,
	type SqliteDatabase,
} from 'remix/data-table/sqlite'
import { migrateDatabase } from './migrate.ts'

/**
 * An in-memory database with all migrations applied. Dispose it to close the
 * underlying connection.
 */
export async function createTestDatabase(): Promise<{
	db: SqliteDatabase
	sqlite: DatabaseSync
	[Symbol.dispose]: () => void
}> {
	const sqlite = new DatabaseSync(':memory:')
	const db = createSqliteDatabase(sqlite)
	await migrateDatabase(db)

	return {
		db,
		sqlite,
		[Symbol.dispose]: () => {
			sqlite.close()
		},
	}
}
