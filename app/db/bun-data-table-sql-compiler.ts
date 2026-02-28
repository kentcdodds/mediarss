import {
	getTableName,
	getTablePrimaryKey,
	type AdapterStatement,
} from 'remix/data-table'

type CompilerContext = {
	values: Array<unknown>
}

type CompiledStatement = {
	text: string
	values: Array<unknown>
}

export function compileBunSqliteStatement(
	statement: AdapterStatement,
): CompiledStatement {
	if (statement.kind === 'raw') {
		return {
			text: statement.sql.text,
			values: [...statement.sql.values],
		}
	}

	const context: CompilerContext = { values: [] }

	if (statement.kind === 'select') {
		let selection = '*'
		if (statement.select !== '*') {
			selection = statement.select
				.map(
					(field) =>
						`${quotePath(field.column)} as ${quoteIdentifier(field.alias)}`,
				)
				.join(', ')
		}

		return {
			text:
				`select ${statement.distinct ? 'distinct ' : ''}${selection}` +
				compileFromClause(statement.table, statement.joins, context) +
				compileWhereClause(statement.where, context) +
				compileGroupByClause(statement.groupBy) +
				compileHavingClause(statement.having, context) +
				compileOrderByClause(statement.orderBy) +
				compileLimitClause(statement.limit) +
				compileOffsetClause(statement.offset),
			values: context.values,
		}
	}

	if (statement.kind === 'count' || statement.kind === 'exists') {
		const inner =
			'select 1' +
			compileFromClause(statement.table, statement.joins, context) +
			compileWhereClause(statement.where, context) +
			compileGroupByClause(statement.groupBy) +
			compileHavingClause(statement.having, context)

		return {
			text: `select count(*) as ${quoteIdentifier('count')} from (${inner}) as ${quoteIdentifier('__dt_count')}`,
			values: context.values,
		}
	}

	if (statement.kind === 'insert') {
		return compileInsertStatement(
			statement.table,
			statement.values,
			statement.returning,
			context,
		)
	}

	if (statement.kind === 'insertMany') {
		return compileInsertManyStatement(
			statement.table,
			statement.values,
			statement.returning,
			context,
		)
	}

	if (statement.kind === 'update') {
		const columns = Object.keys(statement.changes)
		return {
			text:
				`update ${quotePath(getTableName(statement.table))} set ` +
				columns
					.map(
						(column) =>
							`${quotePath(column)} = ${pushValue(context, statement.changes[column])}`,
					)
					.join(', ') +
				compileWhereClause(statement.where, context) +
				compileReturningClause(statement.returning),
			values: context.values,
		}
	}

	if (statement.kind === 'delete') {
		return {
			text:
				`delete from ${quotePath(getTableName(statement.table))}` +
				compileWhereClause(statement.where, context) +
				compileReturningClause(statement.returning),
			values: context.values,
		}
	}

	if (statement.kind === 'upsert') {
		return compileUpsertStatement(statement, context)
	}

	throw new Error('Unsupported statement kind')
}

function compileInsertStatement(
	table: { [key: string]: unknown },
	values: Record<string, unknown>,
	returning: '*' | Array<string> | undefined,
	context: CompilerContext,
): CompiledStatement {
	const columns = Object.keys(values)
	if (columns.length === 0) {
		return {
			text:
				`insert into ${quotePath(getTableName(table))} default values` +
				compileReturningClause(returning),
			values: context.values,
		}
	}

	return {
		text:
			`insert into ${quotePath(getTableName(table))} (` +
			columns.map((column) => quotePath(column)).join(', ') +
			') values (' +
			columns.map((column) => pushValue(context, values[column])).join(', ') +
			')' +
			compileReturningClause(returning),
		values: context.values,
	}
}

function compileInsertManyStatement(
	table: { [key: string]: unknown },
	rows: Array<Record<string, unknown>>,
	returning: '*' | Array<string> | undefined,
	context: CompilerContext,
): CompiledStatement {
	if (rows.length === 0) {
		return {
			text: 'select 0 where 1 = 0',
			values: context.values,
		}
	}

	const columns = collectColumns(rows)
	if (columns.length === 0) {
		return {
			text:
				`insert into ${quotePath(getTableName(table))} default values` +
				compileReturningClause(returning),
			values: context.values,
		}
	}

	return {
		text:
			`insert into ${quotePath(getTableName(table))} (` +
			columns.map((column) => quotePath(column)).join(', ') +
			') values ' +
			rows
				.map((row) => {
					const values = columns
						.map((column) => {
							const value = Object.hasOwn(row, column)
								? row[column]
								: null
							return pushValue(context, value)
						})
						.join(', ')
					return `(${values})`
				})
				.join(', ') +
			compileReturningClause(returning),
		values: context.values,
	}
}

function compileUpsertStatement(
	statement: Extract<AdapterStatement, { kind: 'upsert' }>,
	context: CompilerContext,
): CompiledStatement {
	const insertColumns = Object.keys(statement.values)
	const conflictTarget = statement.conflictTarget ?? [
		...getTablePrimaryKey(statement.table),
	]

	if (insertColumns.length === 0) {
		throw new Error('upsert requires at least one value')
	}

	const updateValues = statement.update ?? statement.values
	const updateColumns = Object.keys(updateValues)

	const conflictClause =
		updateColumns.length === 0
			? ` on conflict (${conflictTarget.map((column) => quotePath(column)).join(', ')}) do nothing`
			: ` on conflict (${conflictTarget.map((column) => quotePath(column)).join(', ')}) do update set ${updateColumns
					.map(
						(column) =>
							`${quotePath(column)} = ${pushValue(context, updateValues[column])}`,
					)
					.join(', ')}`

	return {
		text:
			`insert into ${quotePath(getTableName(statement.table))} (` +
			insertColumns.map((column) => quotePath(column)).join(', ') +
			') values (' +
			insertColumns
				.map((column) => pushValue(context, statement.values[column]))
				.join(', ') +
			')' +
			conflictClause +
			compileReturningClause(statement.returning),
		values: context.values,
	}
}

function compileFromClause(
	table: { [key: string]: unknown },
	joins: Array<{
		type: 'inner' | 'left' | 'right'
		table: { [key: string]: unknown }
		on: unknown
	}>,
	context: CompilerContext,
): string {
	let output = ` from ${quotePath(getTableName(table))}`
	for (const join of joins) {
		output +=
			` ${normalizeJoinType(join.type)} join ${quotePath(getTableName(join.table))}` +
			` on ${compilePredicate(join.on, context)}`
	}
	return output
}

function compileWhereClause(
	predicates: Array<unknown>,
	context: CompilerContext,
): string {
	if (predicates.length === 0) return ''
	return ` where ${predicates
		.map((predicate) => `(${compilePredicate(predicate, context)})`)
		.join(' and ')}`
}

function compileGroupByClause(columns: Array<string>): string {
	if (columns.length === 0) return ''
	return ` group by ${columns.map((column) => quotePath(column)).join(', ')}`
}

function compileHavingClause(
	predicates: Array<unknown>,
	context: CompilerContext,
): string {
	if (predicates.length === 0) return ''
	return ` having ${predicates
		.map((predicate) => `(${compilePredicate(predicate, context)})`)
		.join(' and ')}`
}

function compileOrderByClause(
	orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>,
): string {
	if (orderBy.length === 0) return ''
	return ` order by ${orderBy
		.map(
			(clause) =>
				`${quotePath(clause.column)} ${clause.direction.toUpperCase()}`,
		)
		.join(', ')}`
}

function compileLimitClause(limit: number | undefined): string {
	if (limit === undefined) return ''
	return ` limit ${String(limit)}`
}

function compileOffsetClause(offset: number | undefined): string {
	if (offset === undefined) return ''
	return ` offset ${String(offset)}`
}

function compileReturningClause(
	returning: '*' | Array<string> | undefined,
): string {
	if (!returning) return ''
	if (returning === '*') return ' returning *'
	return ` returning ${returning.map((column) => quotePath(column)).join(', ')}`
}

function compilePredicate(
	predicate: unknown,
	context: CompilerContext,
): string {
	const current = predicate as {
		type: string
		column?: string
		operator?: string
		value?: unknown
		valueType?: 'value' | 'column'
		lower?: unknown
		upper?: unknown
		predicates?: Array<unknown>
	}

	if (current.type === 'comparison') {
		const column = quotePath(current.column ?? '')
		if (current.operator === 'eq') {
			if (
				current.valueType === 'value' &&
				(current.value === null || current.value === undefined)
			) {
				return `${column} is null`
			}
			return `${column} = ${compileComparisonValue(current, context)}`
		}

		if (current.operator === 'ne') {
			if (
				current.valueType === 'value' &&
				(current.value === null || current.value === undefined)
			) {
				return `${column} is not null`
			}
			return `${column} <> ${compileComparisonValue(current, context)}`
		}

		if (current.operator === 'gt') {
			return `${column} > ${compileComparisonValue(current, context)}`
		}
		if (current.operator === 'gte') {
			return `${column} >= ${compileComparisonValue(current, context)}`
		}
		if (current.operator === 'lt') {
			return `${column} < ${compileComparisonValue(current, context)}`
		}
		if (current.operator === 'lte') {
			return `${column} <= ${compileComparisonValue(current, context)}`
		}
		if (current.operator === 'in' || current.operator === 'notIn') {
			const values = Array.isArray(current.value) ? current.value : []
			if (values.length === 0) {
				return current.operator === 'in' ? '1 = 0' : '1 = 1'
			}
			const keyword = current.operator === 'in' ? 'in' : 'not in'
			return `${column} ${keyword} (${values
				.map((value) => pushValue(context, value))
				.join(', ')})`
		}
		if (current.operator === 'like') {
			return `${column} like ${compileComparisonValue(current, context)}`
		}
		if (current.operator === 'ilike') {
			const value = compileComparisonValue(current, context)
			return `lower(${column}) like lower(${value})`
		}
	}

	if (current.type === 'between') {
		return `${quotePath(current.column ?? '')} between ${pushValue(context, current.lower)} and ${pushValue(context, current.upper)}`
	}

	if (current.type === 'null') {
		return `${quotePath(current.column ?? '')}${current.operator === 'isNull' ? ' is null' : ' is not null'}`
	}

	if (current.type === 'logical') {
		const predicates = current.predicates ?? []
		if (predicates.length === 0) {
			return current.operator === 'and' ? '1 = 1' : '1 = 0'
		}
		const joiner = current.operator === 'and' ? ' and ' : ' or '
		return predicates
			.map((child) => `(${compilePredicate(child, context)})`)
			.join(joiner)
	}

	throw new Error('Unsupported predicate')
}

function compileComparisonValue(
	predicate: { valueType?: 'value' | 'column'; value?: unknown },
	context: CompilerContext,
): string {
	if (predicate.valueType === 'column') {
		return quotePath(String(predicate.value ?? ''))
	}
	return pushValue(context, predicate.value)
}

function normalizeJoinType(type: 'inner' | 'left' | 'right'): string {
	if (type === 'left') return 'left'
	if (type === 'right') return 'right'
	return 'inner'
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`
}

function quotePath(path: string): string {
	if (path === '*') return '*'
	return path
		.split('.')
		.map((segment) => (segment === '*' ? '*' : quoteIdentifier(segment)))
		.join('.')
}

function pushValue(context: CompilerContext, value: unknown): string {
	context.values.push(normalizeBoundValue(value))
	return '?'
}

function normalizeBoundValue(value: unknown): unknown {
	if (typeof value === 'boolean') {
		return value ? 1 : 0
	}
	return value
}

function collectColumns(rows: Array<Record<string, unknown>>): Array<string> {
	const columns: Array<string> = []
	const seen = new Set<string>()
	for (const row of rows) {
		for (const key in row) {
			if (!Object.hasOwn(row, key) || seen.has(key)) {
				continue
			}
			seen.add(key)
			columns.push(key)
		}
	}
	return columns
}
