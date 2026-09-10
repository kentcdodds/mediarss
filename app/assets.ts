import path from 'node:path'
import { createAssetServer, type ScriptEntry } from 'remix/assets'
import { loadConfig } from 'remix/cli'

const isDevelopment = process.env.NODE_ENV === 'development'
const isHmr = isDevelopment && Boolean(process.env.REMIX_NODE_HMR)

export const ADMIN_ENTRY = 'app/client/admin/entry.tsx'
export const MEDIA_WIDGET_ENTRY = 'app/client/widgets/media-player.tsx'
export const STYLESHEET = 'app/assets/styles.css'

/**
 * `match-sorter` depends on the CommonJS-only `remove-accents` package, which
 * `remix/assets` cannot serve as a browser module. It is marked external and
 * mapped to this ESM stand-in through the import map.
 */
const REMOVE_ACCENTS_SHIM = 'app/client/vendor/remove-accents.ts'

const config = await loadConfig(path.resolve(import.meta.dirname, '..'))
if (!config.assets) {
	throw new Error('remix.json must define an "assets" section')
}

export const ASSETS_BASE_PATH = config.assets.basePath

export const assets = createAssetServer({
	...config.assets,
	scripts: {
		external: ['remove-accents'],
		loaders: isHmr
			? [(await import('remix/ui-hmr/assets')).uiHmr()]
			: undefined,
	},
	hmr: isHmr
		? {
				channel: async () =>
					(await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
				moduleImporter: 'remix/multiple-import-maps-polyfill',
			}
		: undefined,
	minify: !isDevelopment,
	sourceMaps: isDevelopment ? 'inline' : undefined,
	fingerprint: !isDevelopment,
	watch: isDevelopment,
})

/**
 * Resolve a browser script entry along with the import map it needs, including
 * the `remove-accents` stand-in for `match-sorter`.
 */
export async function getScriptEntry(entry: string): Promise<ScriptEntry> {
	const [scriptEntry, removeAccentsHref] = await Promise.all([
		assets.getScriptEntry(entry),
		assets.getHref(REMOVE_ACCENTS_SHIM),
	])
	return {
		...scriptEntry,
		importMap: {
			...scriptEntry.importMap,
			imports: {
				...scriptEntry.importMap.imports,
				'remove-accents': removeAccentsHref,
			},
		},
	}
}

export function getStylesheetHref() {
	return assets.getHref(STYLESHEET)
}
