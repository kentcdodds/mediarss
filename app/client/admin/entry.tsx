import {
	detectMultipleImportMapSupport,
	importModule,
	preloadShim,
} from 'remix/multiple-import-maps-polyfill'
import { run } from 'remix/ui'

const app = run({
	async loadModule(moduleUrl, exportName) {
		const module: Record<string, unknown> = await importModule(moduleUrl)
		const component = module[exportName]
		if (typeof component !== 'function') {
			throw new Error(`Unknown client entry: ${moduleUrl}#${exportName}`)
		}
		return component
	},
	async processClientEntryPreloads(preloads) {
		if (await detectMultipleImportMapSupport()) return preloads

		preloadShim(preloads)
		return []
	},
})

app.addEventListener('error', (event) => {
	console.error('Admin hydration error:', event.error)
})

void app.ready().catch(() => {
	// The error event listener above reports hydration and initialization failures.
})
