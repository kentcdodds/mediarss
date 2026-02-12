import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { migrate } from './migrations.ts'

export function createMigratedTestDatabase(prefix: string): {
	db: Database
	[Symbol.dispose]: () => void
} {
	const dbPath = `./data/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
	const dir = path.dirname(dbPath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}

	const db = new Database(dbPath)
	migrate(db)

	return {
		db,
		[Symbol.dispose]: () => {
			db.close()
			if (fs.existsSync(dbPath)) {
				fs.unlinkSync(dbPath)
			}
		},
	}
}
