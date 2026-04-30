/**
 * Shared import map configuration for client-side modules.
 *
 * This is used by both the main Layout component and MCP widgets
 * to ensure consistent module resolution across the application.
 */

/**
 * Base import map without versioning.
 * Maps bare module specifiers to their bundling endpoints.
 */
export const baseImportMap = {
	'remix/ui': '/node_modules/remix/ui',
	'remix/ui/jsx-runtime': '/node_modules/remix/ui/jsx-runtime',
	'remix/ui/jsx-dev-runtime': '/node_modules/remix/ui/jsx-dev-runtime',
	'remix/data-schema': '/node_modules/remix/data-schema',
	'match-sorter': '/node_modules/match-sorter',
} as const
