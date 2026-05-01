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
})

app.addEventListener('error', (event) => {
	console.error('Admin enhancement error:', event.error)
})

await app.ready()
