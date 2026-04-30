import { run } from 'remix/ui'
import { setAdminRouterPath } from './router.tsx'

setAdminRouterPath(`${window.location.pathname}${window.location.search}`)

const app = run({
	async loadModule(moduleUrl, exportName) {
		const mod = await import(moduleUrl)
		return mod[exportName]
	},
	async resolveFrame(src, signal, target) {
		const headers = new Headers({ accept: 'text/html' })
		if (target) headers.set('x-remix-target', target)
		const response = await fetch(src, { headers, signal })
		if (!response.ok)
			throw new Error(`Failed to load ${src}: ${response.status}`)
		return response.body ?? (await response.text())
	},
})

app.addEventListener('error', (event) => {
	console.error('Component error:', event.error)
})

await app.ready()
