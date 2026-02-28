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
	'remix/component': '/node_modules/remix/component',
	'remix/component/jsx-runtime': '/node_modules/remix/component/jsx-runtime',
	'remix/component/jsx-dev-runtime':
		'/node_modules/remix/component/jsx-dev-runtime',
	'remix/interaction': '/node_modules/remix/interaction',
	'remix/interaction/press': '/node_modules/remix/interaction/press',
	'remix/data-schema': '/node_modules/remix/data-schema',
	'match-sorter': '/node_modules/match-sorter',
} as const
