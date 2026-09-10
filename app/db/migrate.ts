import { fileURLToPath } from 'node:url'
import { type Database, type MigrateResult } from 'remix/data-table'
import { loadMigrations } from 'remix/data-table/migrations/node'

export const migrationsDirectory = fileURLToPath(
	new URL('./migrations/', import.meta.url),
)

const MINIMUM_LEGACY_SCHEMA_VERSION = 8

/**
 * Databases created by the previous hand-rolled migration runner (journaled in
 * `schema_versions`) are adopted by the baseline migration: every statement in
 * it is idempotent, and it drops `schema_versions` at the end. That only holds
 * for the legacy runner's final schema version, so refuse anything older.
 */
async function assertLegacyDatabaseIsAdoptable(database: Database) {
	if (!(await database.hasTable({ name: 'schema_versions' }))) return

	const result = await database.exec(
		'SELECT MAX(version) AS version FROM schema_versions',
	)
	const version = Number(result.rows?.[0]?.version ?? 0)
	if (version < MINIMUM_LEGACY_SCHEMA_VERSION) {
		throw new Error(
			`Database schema version ${version} is older than the supported baseline (${MINIMUM_LEGACY_SCHEMA_VERSION}). Start the previous release once to upgrade it first.`,
		)
	}
}

/**
 * Apply all pending SQL migrations. Called at startup before the first request
 * is served; `remix db migrate` runs the same migrations from the CLI.
 */
export async function migrateDatabase(
	database: Database,
): Promise<MigrateResult> {
	await assertLegacyDatabaseIsAdoptable(database)
	const migrations = await loadMigrations(migrationsDirectory)
	const result = await database.migrate(migrations)
	for (const migration of result.applied) {
		console.log(`Applied migration ${migration.id}_${migration.name}`)
	}
	return result
}
