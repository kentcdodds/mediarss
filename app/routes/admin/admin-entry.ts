import { run } from 'remix/ui'

const app = run({
	async loadModule(moduleUrl, exportName) {
		const mod = await import(moduleUrl)
		return mod[exportName]
	},
})

app.addEventListener('error', (event) => {
	console.error('Admin enhancement error:', event.error)
})

await app.ready()
