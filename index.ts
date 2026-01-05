import { db } from './app/db/index.ts'
import { migrate } from './app/db/migrations.ts'
import router from './app/router.tsx'
import { createBundlingRoutes } from './server/bundling.ts'
import { setupInteractiveCli } from './server/cli.ts'

// Initialize database and run migrations
migrate(db)

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 44100

const server = Bun.serve({
	port,
	routes: createBundlingRoutes(import.meta.dirname),

	async fetch(request) {
		try {
			return await router.fetch(request)
		} catch (error) {
			console.error(error)
			return new Response('Internal Server Error', { status: 500 })
		}
	},
})

const url = `http://${server.hostname}:${server.port}`

setupInteractiveCli(url)
