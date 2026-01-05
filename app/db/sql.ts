import type { z } from 'zod'

/**
 * Template tag for SQL that joins multiline SQL into a single line.
 * Makes SQL strings more readable while producing clean single-line output.
 */
export function sql(
	strings: TemplateStringsArray,
	...values: Array<string>
): string {
	const joined = strings.reduce((result, str, i) => {
		return result + str + (values[i] || '')
	}, '')
	return joined
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join(' ')
}

/**
 * Converts snake_case database row keys to camelCase JavaScript object keys.
 */
export function snakeToCamel<T extends Record<string, unknown>>(obj: T) {
	const entries = Object.entries(obj).map(([key, value]) => {
		const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
			letter.toUpperCase(),
		)
		return [camelKey, value]
	})
	return Object.fromEntries(entries) as {
		[K in keyof T as K extends string
			? K extends `${string}_${string}`
				? never
				: K
			: K]: T[K]
	} & {
		[K in keyof T as K extends `${infer Start}_${infer Letter}${infer Rest}`
			? `${Start}${Uppercase<Letter>}${Rest}`
			: never]: T[K]
	}
}

/**
 * Converts a database row to a validated object using a Zod schema.
 * Performs snake_case to camelCase conversion and runtime type validation.
 */
export function parseRow<T extends z.ZodTypeAny>(
	schema: T,
	row: Record<string, unknown>,
): z.infer<T> {
	const camelCased = snakeToCamel(row)
	return schema.parse(camelCased)
}

/**
 * Converts multiple database rows to validated objects using a Zod schema.
 */
export function parseRows<T extends z.ZodTypeAny>(
	schema: T,
	rows: Array<Record<string, unknown>>,
): Array<z.infer<T>> {
	return rows.map((row) => parseRow(schema, row))
}
