import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import {
	cachified as baseCachified,
	type Cache,
	type CacheEntry,
	type CachifiedOptions,
} from '@epic-web/cachified'
import { z } from 'zod'
import { getEnv } from '#app/config/env.ts'
import { sql } from '#app/db/sql.ts'

function ensureDirectoryExists(filePath: string): void {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

function createCacheDatabase(): Database {
	const dbPath = getEnv().CACHE_DATABASE_PATH
	ensureDirectoryExists(dbPath)

	const db = new Database(dbPath)

	// Enable WAL mode for better concurrent performance
	db.run('PRAGMA journal_mode = WAL')

	// Create cache table if it doesn't exist
	db.run(sql`
		CREATE TABLE IF NOT EXISTS cache (
			key TEXT PRIMARY KEY,
			metadata TEXT NOT NULL,
			value TEXT NOT NULL
		)
	`)

	return db
}

// Lazy singleton database instance
let _cacheDb: Database | null = null

function getCacheDb(): Database {
	if (!_cacheDb) {
		_cacheDb = createCacheDatabase()
	}
	return _cacheDb
}

// Type for cache row results
type CacheRow = { metadata: string; value: string }

// Lazy prepared statements with explicit types
let _getStatement: ReturnType<
	typeof Database.prototype.prepare<CacheRow, [string]>
> | null = null
let _setStatement: ReturnType<
	typeof Database.prototype.prepare<void, [string, string, string]>
> | null = null
let _deleteStatement: ReturnType<
	typeof Database.prototype.prepare<void, [string]>
> | null = null

function getGetStatement() {
	if (!_getStatement) {
		_getStatement = getCacheDb().prepare<CacheRow, [string]>(
			'SELECT metadata, value FROM cache WHERE key = ?',
		)
	}
	return _getStatement
}

function getSetStatement() {
	if (!_setStatement) {
		_setStatement = getCacheDb().prepare<void, [string, string, string]>(
			'INSERT OR REPLACE INTO cache (key, metadata, value) VALUES (?, ?, ?)',
		)
	}
	return _setStatement
}

function getDeleteStatement() {
	if (!_deleteStatement) {
		_deleteStatement = getCacheDb().prepare<void, [string]>(
			'DELETE FROM cache WHERE key = ?',
		)
	}
	return _deleteStatement
}

// Schema for validating cache entry metadata
const cacheMetadataSchema = z.object({
	createdTime: z.number(),
	ttl: z.number().nullable().optional(),
	swr: z.number().nullable().optional(),
})

/**
 * SQLite-backed cache implementation for cachified.
 */
export const cache: Cache = {
	name: 'SQLite cache',

	get(key: string) {
		const row = getGetStatement().get(key)
		if (!row) return null

		try {
			const metadata = cacheMetadataSchema.parse(JSON.parse(row.metadata))
			const value = JSON.parse(row.value)
			return { metadata, value }
		} catch (error) {
			console.error(`Cache parse error for key "${key}":`, error)
			// Invalid cache entry, delete it
			getDeleteStatement().run(key)
			return null
		}
	},

	set(key: string, entry: CacheEntry) {
		const metadata = JSON.stringify(entry.metadata)
		const value = JSON.stringify(entry.value)
		getSetStatement().run(key, metadata, value)
	},

	delete(key: string) {
		getDeleteStatement().run(key)
	},
}

/**
 * Check if a cached value should be refreshed based on file modification time.
 * Returns true if the file has been modified since the cache entry was created.
 */
export function shouldRefreshCache(key: string, fileMtime: number): boolean {
	// Direct database access for synchronous check (cache.get returns sync for our impl)
	const row = getGetStatement().get(key)
	if (!row) return false // No cache entry, will fetch fresh anyway

	try {
		const metadata = cacheMetadataSchema.parse(JSON.parse(row.metadata))
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
 * Get all cache keys (useful for debugging/admin).
 */
export function getAllCacheKeys(limit = 1000): string[] {
	const statement = getCacheDb().prepare<{ key: string }, [number]>(
		'SELECT key FROM cache LIMIT ?',
	)
	return statement.all(limit).map((row) => row.key)
}

/**
 * Search cache keys by pattern (useful for debugging/admin).
 */
export function searchCacheKeys(search: string, limit = 100): string[] {
	const statement = getCacheDb().prepare<{ key: string }, [string, number]>(
		'SELECT key FROM cache WHERE key LIKE ? LIMIT ?',
	)
	return statement.all(`%${search}%`, limit).map((row) => row.key)
}

/**
 * Clear all cache entries (useful for debugging/admin).
 */
export function clearCache(): void {
	getCacheDb().run('DELETE FROM cache')
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { count: number; sizeBytes: number } {
	const db = getCacheDb()
	const countResult = db
		.prepare<{ count: number }, []>('SELECT COUNT(*) as count FROM cache')
		.get()
	const count = countResult?.count ?? 0

	// Estimate size based on page count and page size
	const pageCount = db
		.prepare<{ page_count: number }, []>('PRAGMA page_count')
		.get()
	const pageSize = db
		.prepare<{ page_size: number }, []>('PRAGMA page_size')
		.get()
	const sizeBytes = (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0)

	return { count, sizeBytes }
}
