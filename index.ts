// Initialize environment variables
import '#app/config/init-env.ts'

import { getEnv } from '#app/config/env.ts'
import { db } from './app/db/index.ts'
import { migrate } from './app/db/migrations.ts'
import router from './app/router.tsx'
import { createBundlingRoutes } from './server/bundling.ts'
import { setupInteractiveCli } from './server/cli.ts'

const env = getEnv()

// Initialize database and run migrations
migrate(db)

const server = Bun.serve({
	port: env.PORT,
	routes: createBundlingRoutes(import.meta.dirname),

	async fetch(request) {
		try {
			const url = new URL(request.url)
			if (url.pathname === '/') {
				return Response.redirect(new URL('/admin', request.url), 302)
			}
			return await router.fetch(request)
		} catch (error) {
			console.error(error)
			return new Response('Internal Server Error', { status: 500 })
		}
	},
})

const url = `http://${server.hostname}:${server.port}`

setupInteractiveCli(url)
