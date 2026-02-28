import type { Database as BunDatabase } from 'bun:sqlite'
import type {
	AdapterCapabilityOverrides,
	AdapterExecuteRequest,
	AdapterResult,
	DatabaseAdapter,
	TransactionOptions,
	TransactionToken,
} from 'remix/data-table'
import { getTablePrimaryKey } from 'remix/data-table'
import { compileBunSqliteStatement } from './bun-data-table-sql-compiler.ts'

type BunStatementResult = {
	changes: number
	lastInsertRowid: number | bigint
}

type BunPreparedStatement = {
	all: (...values: Array<unknown>) => Array<Record<string, unknown>>
	run: (...values: Array<unknown>) => BunStatementResult
}

export type BunSqliteDatabaseConnection = BunDatabase

export type BunSqliteDatabaseAdapterOptions = {
	capabilities?: AdapterCapabilityOverrides
}

export class BunSqliteDatabaseAdapter implements DatabaseAdapter {
	dialect = 'sqlite'
	capabilities = {
		returning: true,
		savepoints: true,
		upsert: true,
	}

	#database: BunSqliteDatabaseConnection
	#transactions = new Set<string>()
	#transactionCounter = 0

	constructor(
		database: BunSqliteDatabaseConnection,
		options?: BunSqliteDatabaseAdapterOptions,
	) {
		this.#database = database
		this.capabilities = {
			returning: options?.capabilities?.returning ?? true,
			savepoints: options?.capabilities?.savepoints ?? true,
			upsert: options?.capabilities?.upsert ?? true,
		}
	}

	async execute(request: AdapterExecuteRequest): Promise<AdapterResult> {
		if (
			request.statement.kind === 'insertMany' &&
			request.statement.values.length === 0
		) {
			return {
				affectedRows: 0,
				insertId: undefined,
				rows: request.statement.returning ? [] : undefined,
			}
		}

		const compiled = compileBunSqliteStatement(request.statement)
		const prepared = this.#database.prepare(
			compiled.text,
		) as unknown as BunPreparedStatement
		const readWithAll = shouldExecuteAsReader(request.statement, compiled.text)

		if (readWithAll) {
			let rows = normalizeRows(prepared.all(...compiled.values))
			if (
				request.statement.kind === 'count' ||
				request.statement.kind === 'exists'
			) {
				rows = normalizeCountRows(rows)
			}

			return {
				rows,
				affectedRows: normalizeAffectedRowsForReader(
					request.statement.kind,
					rows,
				),
				insertId: normalizeInsertIdForReader(request.statement, rows),
			}
		}

		const result = prepared.run(...compiled.values)
		return {
			affectedRows: normalizeAffectedRowsForRun(request.statement.kind, result),
			insertId: normalizeInsertIdForRun(request.statement, result),
		}
	}

	async beginTransaction(
		options?: TransactionOptions,
	): Promise<TransactionToken> {
		if (options?.isolationLevel === 'read uncommitted') {
			this.#database.exec('pragma read_uncommitted = true')
		}

		this.#database.exec('begin')
		this.#transactionCounter += 1
		const token = { id: `tx_${String(this.#transactionCounter)}` }
		this.#transactions.add(token.id)
		return token
	}

	async commitTransaction(token: TransactionToken): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec('commit')
		this.#transactions.delete(token.id)
	}

	async rollbackTransaction(token: TransactionToken): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec('rollback')
		this.#transactions.delete(token.id)
	}

	async createSavepoint(token: TransactionToken, name: string): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec(`savepoint ${quoteIdentifier(name)}`)
	}

	async rollbackToSavepoint(
		token: TransactionToken,
		name: string,
	): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec(`rollback to savepoint ${quoteIdentifier(name)}`)
	}

	async releaseSavepoint(token: TransactionToken, name: string): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec(`release savepoint ${quoteIdentifier(name)}`)
	}

	#assertTransaction(token: TransactionToken): void {
		if (!this.#transactions.has(token.id)) {
			throw new Error(`Unknown transaction token: ${token.id}`)
		}
	}
}

export function createBunSqliteDatabaseAdapter(
	database: BunSqliteDatabaseConnection,
	options?: BunSqliteDatabaseAdapterOptions,
): BunSqliteDatabaseAdapter {
	return new BunSqliteDatabaseAdapter(database, options)
}

function shouldExecuteAsReader(
	statement: AdapterExecuteRequest['statement'],
	compiledText: string,
): boolean {
	if (
		statement.kind === 'select' ||
		statement.kind === 'count' ||
		statement.kind === 'exists'
	) {
		return true
	}

	if (statement.kind === 'raw') {
		return isReaderSql(compiledText)
	}

	return hasReturningClause(statement)
}

function hasReturningClause(
	statement: AdapterExecuteRequest['statement'],
): boolean {
	if ('returning' in statement) {
		return statement.returning !== undefined
	}
	return false
}

function isReaderSql(sqlText: string): boolean {
	const normalized = sqlText.trim().toLowerCase()
	if (normalized.startsWith('with')) {
		return !/\b(insert|update|delete|replace)\b/.test(normalized)
	}
	return /^(select|pragma|explain)\b/.test(normalized)
}

function normalizeRows(rows: Array<unknown>): Array<Record<string, unknown>> {
	return rows.map((row) =>
		typeof row === 'object' && row !== null
			? { ...(row as Record<string, unknown>) }
			: {},
	)
}

function normalizeCountRows(
	rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
	return rows.map((row) => {
		const count = row.count
		if (typeof count === 'string') {
			const numeric = Number(count)
			if (!Number.isNaN(numeric)) {
				return { ...row, count: numeric }
			}
		}
		if (typeof count === 'bigint') {
			return { ...row, count: Number(count) }
		}
		return row
	})
}

function normalizeAffectedRowsForReader(
	kind: AdapterExecuteRequest['statement']['kind'],
	rows: Array<Record<string, unknown>>,
): number | undefined {
	if (isWriteStatementKind(kind)) {
		return rows.length
	}
	return undefined
}

function normalizeInsertIdForReader(
	statement: AdapterExecuteRequest['statement'],
	rows: Array<Record<string, unknown>>,
): unknown {
	if (!isInsertStatementKind(statement.kind) || !('table' in statement)) {
		return undefined
	}

	const primaryKey = getTablePrimaryKey(statement.table)
	if (primaryKey.length !== 1) {
		return undefined
	}

	const key = primaryKey[0]
	if (!key) {
		return undefined
	}
	const row = rows[rows.length - 1]
	return row ? row[key] : undefined
}

function normalizeAffectedRowsForRun(
	kind: AdapterExecuteRequest['statement']['kind'],
	result: BunStatementResult,
): number | undefined {
	if (kind === 'select' || kind === 'count' || kind === 'exists') {
		return undefined
	}
	return result.changes
}

function normalizeInsertIdForRun(
	statement: AdapterExecuteRequest['statement'],
	result: BunStatementResult,
): unknown {
	if (!isInsertStatementKind(statement.kind) || !('table' in statement)) {
		return undefined
	}

	if (getTablePrimaryKey(statement.table).length !== 1) {
		return undefined
	}
	return result.lastInsertRowid
}

function isWriteStatementKind(
	kind: AdapterExecuteRequest['statement']['kind'],
): boolean {
	return (
		kind === 'insert' ||
		kind === 'insertMany' ||
		kind === 'update' ||
		kind === 'delete' ||
		kind === 'upsert'
	)
}

function isInsertStatementKind(
	kind: AdapterExecuteRequest['statement']['kind'],
): boolean {
	return kind === 'insert' || kind === 'insertMany' || kind === 'upsert'
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`
}
