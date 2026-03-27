import {
	DatabaseSync,
	type SQLInputValue,
	type SQLOutputValue,
	type StatementResultingChanges,
	type StatementSync,
} from 'node:sqlite'

type DatabaseParameters = Array<unknown> | Record<string, unknown>

type BindArgs<TParams extends DatabaseParameters> = TParams extends Array<unknown>
	? TParams
	: [TParams]

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

class PreparedStatement<
	TRow extends Record<string, unknown> = Record<string, unknown>,
	TParams extends DatabaseParameters = [],
> {
	#statement: StatementSync

	constructor(statement: StatementSync) {
		this.#statement = statement
	}

	all(...params: BindArgs<TParams>): Array<TRow> {
		return this.#call('all', params) as Array<TRow>
	}

	get(...params: BindArgs<TParams>): TRow | undefined {
		return this.#call('get', params) as TRow | undefined
	}

	run(...params: BindArgs<TParams>) {
		return normalizeRunResult(this.#call('run', params) as StatementResultingChanges)
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
			timeout: 5_000,
		})
	}

	run(sql: string, ...params: Array<unknown>) {
		return this.prepare(sql).run(...params)
	}

	exec(sql: string): void {
		this.#database.exec(sql)
	}

	query<
		TRow extends Record<string, unknown> = Record<string, unknown>,
		TParams extends DatabaseParameters = [],
	>(sql: string): PreparedStatement<TRow, TParams> {
		return this.prepare<TRow, TParams>(sql)
	}

	prepare<
		TRow extends Record<string, unknown> = Record<string, unknown>,
		TParams extends DatabaseParameters = [],
	>(sql: string): PreparedStatement<TRow, TParams> {
		return new PreparedStatement<TRow, TParams>(this.#database.prepare(sql))
	}

	close(): void {
		this.#database.close()
	}
}

export type StatementResult = ReturnType<PreparedStatement['run']>
export type { SQLOutputValue }
