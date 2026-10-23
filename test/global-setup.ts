import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Module-level code that imports the shared `db` or cache opens
 * DATABASE_PATH / CACHE_DATABASE_PATH. Point both at a throwaway directory so
 * tests never read or migrate a developer's ./data databases and local runs
 * match CI.
 */
export default function setup() {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'mediarss-vitest-'))
	process.env.DATABASE_PATH = path.join(dataDir, 'sqlite.db')
	process.env.CACHE_DATABASE_PATH = path.join(dataDir, 'cache.db')

	return () => {
		rmSync(dataDir, { recursive: true, force: true })
	}
}
