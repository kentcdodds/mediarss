import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { getEnv } from '#app/config/env.ts'

function getDatabasePath(): string {
	const envPath = getEnv().DATABASE_PATH
	if (envPath) return envPath

	// Default: /data/sqlite.db for Docker, ./data/sqlite.db for local dev
	const isDocker = fs.existsSync('/.dockerenv')
	return isDocker ? '/data/sqlite.db' : './data/sqlite.db'
}

function ensureDirectoryExists(filePath: string): void {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

const dbPath = getDatabasePath()
ensureDirectoryExists(dbPath)

export const db = new Database(dbPath)

// Enable WAL mode for better concurrent performance
db.run('PRAGMA journal_mode = WAL')
