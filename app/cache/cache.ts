import fs from 'node:fs'
import path from 'node:path'
import {
	cachified as baseCachified,
	type Cache,
	type CacheEntry,
	type CachifiedOptions,
} from '@epic-web/cachified'
import {
	type InferOutput,
	nullable,
	number,
	object,
	optional,
	parse,
} from 'remix/data-schema'
import { column as c, sql, table } from 'remix/data-table'
import {
	createSqliteDatabase,
	type SqliteDatabase,
} from 'remix/data-table/sqlite'
import { getEnv } from '#app/config/env.ts'

/**
 * The cache lives in its own SQLite file (CACHE_DATABASE_PATH). It is
 * disposable: the table is created on demand and it is not part of the
 * application migration history.
 */
const cacheTable = table({
	name: 'cache',
	primaryKey: 'key',
	columns: {
		key: c.text(),
		metadata: c.text(),
		value: c.text(),
	},
})

async function createCacheDatabase(): Promise<SqliteDatabase> {
	const dbPath = getEnv().CACHE_DATABASE_PATH
	fs.mkdirSync(path.dirname(dbPath), { recursive: true })

	const db = createSqliteDatabase({ filename: dbPath })

	// Enable WAL mode for better concurrent performance
	await db.exec('PRAGMA journal_mode = WAL')

	await db.exec(`
		CREATE TABLE IF NOT EXISTS cache (
			key TEXT PRIMARY KEY,
			metadata TEXT NOT NULL,
			value TEXT NOT NULL
		)
	`)

	return db
}

// Lazy singleton database instance
let _cacheDb: Promise<SqliteDatabase> | null = null

function getCacheDb(): Promise<SqliteDatabase> {
	_cacheDb ??= createCacheDatabase()
	return _cacheDb
}

// Schema for validating cache entry metadata
const cacheMetadataSchema = object({
	createdTime: number(),
	ttl: optional(nullable(number())),
	swr: optional(nullable(number())),
})
type CacheMetadata = InferOutput<typeof cacheMetadataSchema>

async function deleteCacheKey(key: string): Promise<void> {
	const db = await getCacheDb()
	await db.delete(cacheTable, key)
}

/**
 * SQLite-backed cache implementation for cachified.
 */
export const cache: Cache = {
	name: 'SQLite cache',

	async get(key: string) {
		const db = await getCacheDb()
		const row = await db.find(cacheTable, key)
		if (!row) return null

		try {
			const metadata: CacheMetadata = parse(
				cacheMetadataSchema,
				JSON.parse(row.metadata),
			)
			const value = JSON.parse(row.value)
			return { metadata, value }
		} catch (error) {
			console.error(`Cache parse error for key "${key}":`, error)
			// Invalid cache entry, delete it
			await deleteCacheKey(key)
			return null
		}
	},

	async set(key: string, entry: CacheEntry) {
		const db = await getCacheDb()
		await db.query(cacheTable).upsert({
			key,
			metadata: JSON.stringify(entry.metadata),
			value: JSON.stringify(entry.value),
		})
	},

	delete(key: string) {
		return deleteCacheKey(key)
	},
}

/**
 * Check if a cached value should be refreshed based on file modification time.
 * Returns true if the file has been modified since the cache entry was created.
 */
export async function shouldRefreshCache(
	key: string,
	fileMtime: number,
): Promise<boolean> {
	const db = await getCacheDb()
	const row = await db.find(cacheTable, key)
	if (!row) return false // No cache entry, will fetch fresh anyway

	try {
		const metadata: CacheMetadata = parse(
			cacheMetadataSchema,
			JSON.parse(row.metadata),
		)
		// Convert fileMtime from ms to seconds for comparison with createdTime
		const fileMtimeSeconds = Math.floor(fileMtime / 1000)
		const createdTimeSeconds = Math.floor(metadata.createdTime / 1000)
		return fileMtimeSeconds > createdTimeSeconds
	} catch {
		// Invalid cache entry, should be refreshed
		return true
	}
}

/**
 * Wrapper around cachified that uses our SQLite cache by default.
 */
export function cachified<Value>(
	options: Omit<CachifiedOptions<Value>, 'cache'> & { cache?: Cache },
): Promise<Value> {
	return baseCachified({
		cache,
		...options,
	})
}

/**
 * Delete cache entries matching a key prefix.
 * Useful for invalidating related cache entries (e.g., all entries for a specific file).
 * @returns The number of entries deleted
 */
export async function deleteCacheByPrefix(prefix: string): Promise<number> {
	const db = await getCacheDb()
	// Escape LIKE special characters in prefix to prevent unintended matches
	// _ matches any single character, % matches any sequence of characters
	const escapedPrefix = prefix.replace(/[\\%_]/g, '\\$&')
	const result = await db.exec(
		sql`DELETE FROM cache WHERE key LIKE ${`${escapedPrefix}%`} ESCAPE '\\'`,
	)
	return result.affectedRows ?? 0
}
