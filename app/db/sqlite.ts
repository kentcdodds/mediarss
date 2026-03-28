import BetterSqlite3 from 'better-sqlite3'

type DatabaseParameters = Array<unknown> | Record<string, unknown>

type NamedParameters = Record<string, unknown>

function isNamedParameters(value: unknown): value is NamedParameters {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false
	}

	if (value instanceof Date || value instanceof ArrayBuffer) {
		return false
	}

	if (ArrayBuffer.isView(value)) {
		return false
	}

	return Object.getPrototypeOf(value) === Object.prototype
}

type StatementResult = {
	changes: number
	lastInsertRowid: number
}

function normalizeRunResult(result: { changes: number; lastInsertRowid: number | bigint }) {
	return {
		changes: result.changes,
		lastInsertRowid:
			typeof result.lastInsertRowid === 'bigint'
				? Number(result.lastInsertRowid)
				: result.lastInsertRowid,
	}
}

class PreparedStatement<TRow = Record<string, unknown>> {
	#statement: BetterSqlite3.Statement

	constructor(statement: BetterSqlite3.Statement) {
		this.#statement = statement
	}

	all(...params: Array<unknown>): Array<TRow> {
		return this.#call('all', params) as Array<TRow>
	}

	get(...params: Array<unknown>): TRow | undefined {
		return this.#call('get', params) as TRow | undefined
	}

	run(...params: Array<unknown>): StatementResult {
		const result = this.#call('run', params) as {
			changes: number
			lastInsertRowid: number | bigint
		}
		return normalizeRunResult(result)
	}

	#call(method: 'all' | 'get' | 'run', params: Array<unknown>) {
		if (params.length === 1 && isNamedParameters(params[0])) {
			return this.#statement[method](params[0])
		}

		return this.#statement[method](...params)
	}
}

export class Database {
	#database: BetterSqlite3.Database

	constructor(path: string) {
		this.#database = new BetterSqlite3(path)
	}

	get raw(): BetterSqlite3.Database {
		return this.#database
	}

	run(sql: string, ...params: Array<unknown>): StatementResult {
		const statement = this.prepare(sql)
		return statement.run(...params)
	}

	exec(sql: string): void {
		this.#database.exec(sql)
	}

	pragma(sql: string): void {
		this.#database.pragma(sql)
	}

	query<
		TRow = Record<string, unknown>,
		_TParams extends DatabaseParameters = [],
	>(sql: string): PreparedStatement<TRow> {
		return this.prepare<TRow, _TParams>(sql)
	}

	prepare<
		TRow = Record<string, unknown>,
		_TParams extends DatabaseParameters = [],
	>(sql: string): PreparedStatement<TRow> {
		return new PreparedStatement<TRow>(this.#database.prepare(sql))
	}

	close(): void {
		this.#database.close()
	}
}
