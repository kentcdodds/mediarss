import { run } from 'remix/ui'
import { AdminApp, ADMIN_APP_ENTRY_ID } from './app-root.tsx'

const clientRegistry = {
	AdminApp,
} as const

const app = run({
	loadModule(moduleUrl, exportName) {
		const expectedHref = ADMIN_APP_ENTRY_ID.split('#')[0]
		if (moduleUrl !== expectedHref) {
			throw new Error(`Unknown client module URL: ${moduleUrl}`)
		}
		const component = clientRegistry[exportName as keyof typeof clientRegistry]
		if (!component) {
			throw new Error(`Unknown client export: ${exportName}`)
		}
		return component
	},
	async resolveFrame(src, signal, target) {
		const headers = new Headers({ Accept: 'text/html' })
		if (target) headers.set('x-remix-target', target)
		const response = await fetch(src, { headers, signal })
		if (!response.ok) {
			throw new Error(
				`Frame resolve failed (${response.status}) for ${src}${
					target ? ` target=${target}` : ''
				}`,
			)
		}
		return response.body ?? (await response.text())
	},
})

app.addEventListener('error', (event) => {
	console.error('Admin hydration error:', event.error)
})

void app.ready()
