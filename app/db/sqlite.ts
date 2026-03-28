import {
	DatabaseSync,
	type SQLInputValue,
	type SQLOutputValue,
	type StatementResultingChanges,
	type StatementSync,
} from 'node:sqlite'

type DatabaseParameters = Array<unknown> | Record<string, unknown>

type NamedParameters = Record<string, SQLInputValue>

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

function normalizeRunResult(result: StatementResultingChanges) {
	return {
		changes:
			typeof result.changes === 'bigint'
				? Number(result.changes)
				: result.changes,
		lastInsertRowid:
			typeof result.lastInsertRowid === 'bigint'
				? Number(result.lastInsertRowid)
				: result.lastInsertRowid,
	}
}

class PreparedStatement<TRow = Record<string, unknown>> {
	#statement: StatementSync

	constructor(statement: StatementSync) {
		this.#statement = statement
	}

	all(...params: Array<unknown>): Array<TRow> {
		return this.#call('all', params) as Array<TRow>
	}

	get(...params: Array<unknown>): TRow | undefined {
		return this.#call('get', params) as TRow | undefined
	}

	run(...params: Array<unknown>) {
		return normalizeRunResult(
			this.#call('run', params) as StatementResultingChanges,
		)
	}

	#call(method: 'all' | 'get' | 'run', params: Array<unknown>) {
		if (params.length === 1 && isNamedParameters(params[0])) {
			return this.#statement[method](params[0])
		}

		return this.#statement[method](...(params as Array<SQLInputValue>))
	}
}

export class Database {
	#database: DatabaseSync

	constructor(path: string) {
		this.#database = new DatabaseSync(path, {
			enableForeignKeyConstraints: true,
		})
		this.#database.exec('PRAGMA busy_timeout = 5000;')
	}

	run(sql: string, ...params: Array<unknown>) {
		const statement = this.prepare(sql)
		return statement.run(...params)
	}

	exec(sql: string): void {
		this.#database.exec(sql)
	}

	query<
		TRow = Record<string, unknown>,
		TParams extends DatabaseParameters = [],
	>(sql: string): PreparedStatement<TRow> {
		return this.prepare<TRow, TParams>(sql)
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

export type StatementResult = ReturnType<PreparedStatement['run']>
export type { SQLOutputValue }
