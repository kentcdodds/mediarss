import fs from 'node:fs'
import path from 'node:path'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { getEnv } from '#app/config/env.ts'

const dbPath = getEnv().DATABASE_PATH
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = createSqliteDatabase({ filename: dbPath, foreignKeys: true })

await db.exec('PRAGMA journal_mode = WAL')
