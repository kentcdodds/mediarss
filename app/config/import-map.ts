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
	'@remix-run/component': '/node_modules/@remix-run/component',
	'@remix-run/component/jsx-runtime':
		'/node_modules/@remix-run/component/jsx-runtime',
	'@remix-run/component/jsx-dev-runtime':
		'/node_modules/@remix-run/component/jsx-dev-runtime',
	'@remix-run/interaction': '/node_modules/@remix-run/interaction',
	'@remix-run/interaction/press': '/node_modules/@remix-run/interaction/press',
	'match-sorter': '/node_modules/match-sorter',
	zod: '/node_modules/zod',
} as const
