import {
	type AdapterCapabilityOverrides,
	type DatabaseAdapter,
	type DataManipulationOperation,
	type DataManipulationRequest,
	type DataManipulationResult,
	type DataMigrationRequest,
	type DataMigrationResult,
	getTablePrimaryKey,
	type TableRef,
	type TransactionOptions,
	type TransactionToken,
} from 'remix/data-table'
import {
	compileBunSqliteStatement,
	quoteIdentifier,
} from './bun-data-table-sql-compiler.ts'
import { type Database as BunDatabase } from './sqlite.ts'

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
		transactionalDdl: true,
		migrationLock: false,
	}

	#database: BunSqliteDatabaseConnection
	#transactions = new Set<string>()
	#readUncommittedTransactions = new Set<string>()
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
			transactionalDdl: options?.capabilities?.transactionalDdl ?? true,
			migrationLock: options?.capabilities?.migrationLock ?? false,
		}
	}

	compileSql(
		operation:
			| DataManipulationRequest['operation']
			| DataMigrationRequest['operation'],
	) {
		const compiled = compileBunSqliteStatement(
			operation as DataManipulationOperation,
		)
		return [{ text: compiled.text, values: compiled.values }]
	}

	async execute(
		request: DataManipulationRequest,
	): Promise<DataManipulationResult> {
		if (
			request.operation.kind === 'insertMany' &&
			request.operation.values.length === 0
		) {
			return {
				affectedRows: 0,
				insertId: undefined,
				rows: request.operation.returning ? [] : undefined,
			}
		}

		const compiled = compileBunSqliteStatement(request.operation)
		const prepared = this.#database.prepare(
			compiled.text,
		) as unknown as BunPreparedStatement
		const readWithAll = shouldExecuteAsReader(request.operation, compiled.text)

		if (readWithAll) {
			let rows = normalizeRows(prepared.all(...compiled.values))
			if (
				request.operation.kind === 'count' ||
				request.operation.kind === 'exists'
			) {
				rows = normalizeCountRows(rows)
			}

			return {
				rows,
				affectedRows: normalizeAffectedRowsForReader(
					request.operation.kind,
					rows,
				),
				insertId: normalizeInsertIdForReader(request.operation, rows),
			}
		}

		const result = prepared.run(...compiled.values)
		return {
			affectedRows: normalizeAffectedRowsForRun(request.operation.kind, result),
			insertId: normalizeInsertIdForRun(request.operation, result),
		}
	}

	async migrate(request: DataMigrationRequest): Promise<DataMigrationResult> {
		const statements = this.compileSql(request.operation)
		for (const statement of statements) {
			;(
				this.#database.prepare(statement.text).run as (
					...params: Array<unknown>
				) => unknown
			)(...statement.values)
		}
		return { affectedOperations: statements.length }
	}

	async hasTable(
		table: TableRef,
		_transaction?: TransactionToken,
	): Promise<boolean> {
		const schemaPrefix = table.schema ? `${quoteIdentifier(table.schema)}.` : ''
		const rows = this.#database
			.prepare(
				`select 1 as exists_flag from ${schemaPrefix}sqlite_master where type = ? and name = ? limit 1`,
			)
			.all('table', table.name) as Array<Record<string, unknown>>
		return rows.length > 0
	}

	async hasColumn(
		table: TableRef,
		column: string,
		_transaction?: TransactionToken,
	): Promise<boolean> {
		const schemaPrefix = table.schema ? `${quoteIdentifier(table.schema)}.` : ''
		const rows = this.#database
			.prepare(
				`pragma ${schemaPrefix}table_info(${quoteIdentifier(table.name)})`,
			)
			.all() as Array<Record<string, unknown>>
		return rows.some((row) => row.name === column)
	}

	async beginTransaction(
		options?: TransactionOptions,
	): Promise<TransactionToken> {
		const useReadUncommitted = options?.isolationLevel === 'read uncommitted'
		if (useReadUncommitted) {
			this.#database.exec('pragma read_uncommitted = true')
		}

		try {
			this.#database.exec('begin')
		} catch (error) {
			if (useReadUncommitted) {
				this.#database.exec('pragma read_uncommitted = false')
			}
			throw error
		}

		this.#transactionCounter += 1
		const token = { id: `tx_${String(this.#transactionCounter)}` }
		this.#transactions.add(token.id)
		if (useReadUncommitted) {
			this.#readUncommittedTransactions.add(token.id)
		}
		return token
	}

	async commitTransaction(token: TransactionToken): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec('commit')
		if (this.#readUncommittedTransactions.has(token.id)) {
			this.#database.exec('pragma read_uncommitted = false')
			this.#readUncommittedTransactions.delete(token.id)
		}
		this.#transactions.delete(token.id)
	}

	async rollbackTransaction(token: TransactionToken): Promise<void> {
		this.#assertTransaction(token)
		this.#database.exec('rollback')
		if (this.#readUncommittedTransactions.has(token.id)) {
			this.#database.exec('pragma read_uncommitted = false')
			this.#readUncommittedTransactions.delete(token.id)
		}
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
	statement: DataManipulationRequest['operation'],
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
	statement: DataManipulationRequest['operation'],
): boolean {
	if (!('returning' in statement)) return false
	if (Array.isArray(statement.returning)) {
		return statement.returning.length > 0
	}
	return statement.returning !== undefined && statement.returning !== null
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
	kind: DataManipulationRequest['operation']['kind'],
	rows: Array<Record<string, unknown>>,
): number | undefined {
	if (isWriteStatementKind(kind)) {
		return rows.length
	}
	return undefined
}

function normalizeInsertIdForReader(
	statement: DataManipulationRequest['operation'],
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
	if (!key) return undefined
	const row = rows[rows.length - 1]
	return row ? row[key] : undefined
}

function normalizeAffectedRowsForRun(
	kind: DataManipulationRequest['operation']['kind'],
	result: BunStatementResult,
): number | undefined {
	if (kind === 'select' || kind === 'count' || kind === 'exists') {
		return undefined
	}
	return result.changes
}

function normalizeInsertIdForRun(
	statement: DataManipulationRequest['operation'],
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
	kind: DataManipulationRequest['operation']['kind'],
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
	kind: DataManipulationRequest['operation']['kind'],
): boolean {
	return kind === 'insert' || kind === 'insertMany' || kind === 'upsert'
}
