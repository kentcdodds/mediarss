import { type Database, type SqlStatement } from 'remix/data-table'

type SnakeToCamel<S extends string> = S extends `${infer Head}_${infer Tail}`
	? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
	: S

/**
 * A database row with its snake_case column names converted to camelCase.
 */
export type CamelCaseRow<Row> = {
	[Key in keyof Row & string as SnakeToCamel<Key>]: Row[Key]
}

function snakeToCamel(value: string): string {
	return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export function toCamelCaseRow<Row extends Record<string, unknown>>(
	row: Row,
): CamelCaseRow<Row> {
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(row)) {
		result[snakeToCamel(key)] = value
	}
	return result as CamelCaseRow<Row>
}

export function toCamelCaseRows<Row extends Record<string, unknown>>(
	rows: Array<Row>,
): Array<CamelCaseRow<Row>> {
	return rows.map(toCamelCaseRow)
}

/**
 * Run a raw SQL statement (aggregates, dynamic SQL) and type its rows.
 * Prefer the typed table APIs; this is the escape hatch for queries they
 * cannot express.
 */
export async function selectAll<Row>(
	database: Database,
	statement: SqlStatement,
): Promise<Array<Row>> {
	const result = await database.exec(statement)
	return (result.rows ?? []) as Array<Row>
}

export async function selectOne<Row>(
	database: Database,
	statement: SqlStatement,
): Promise<Row | undefined> {
	const rows = await selectAll<Row>(database, statement)
	return rows[0]
}
