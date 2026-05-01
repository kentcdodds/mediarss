import { run } from 'remix/ui'
import { AdminEnhancement } from './enhanced-form.tsx'

const adminModules: Record<string, Record<string, unknown>> = {
	'/app/client/admin/enhanced-form.tsx': { AdminEnhancement },
}

const app = run({
	async loadModule(moduleUrl, exportName) {
		const { pathname } = new URL(moduleUrl, window.location.href)
		const mod = adminModules[pathname] ?? (await import(moduleUrl))
		return mod[exportName]
	},
	async resolveFrame(src, signal, target) {
		const headers = new Headers({ accept: 'text/html' })
		if (target) headers.set('x-remix-target', target)
		const response = await fetch(src, { headers, signal })
		if (!response.ok) {
			throw new Error(`Failed to load ${src}: ${response.status}`)
		}
		return response.body ?? (await response.text())
	},
})

app.addEventListener('error', (event) => {
	console.error('Admin enhancement error:', event.error)
})

await app.ready()
