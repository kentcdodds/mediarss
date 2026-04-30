import { run } from 'remix/ui'
import { setAdminRouterPath } from './router.tsx'

setAdminRouterPath(`${window.location.pathname}${window.location.search}`)

const app = run({
	async loadModule(moduleUrl, exportName) {
		const mod = await import(moduleUrl)
		return mod[exportName]
	},
})

app.addEventListener('error', (event) => {
	console.error('Component error:', event.error)
})

await app.ready()
