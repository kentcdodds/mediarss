// Initialize environment variables
import '#app/config/init-env.ts'

import getPort from 'get-port'
import { getEnv } from '#app/config/env.ts'
import { warmMediaCache } from '#app/helpers/media.ts'
import { db } from './app/db/index.ts'
import { migrate } from './app/db/migrations.ts'
import router from './app/router.tsx'
import { createBundlingRoutes } from './server/bundling.ts'
import { setupInteractiveCli } from './server/cli.ts'

const env = getEnv()

// Initialize database and run migrations
migrate(db)

function startServer(port: number) {
	return Bun.serve({
		port,
		idleTimeout: 30, // seconds
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
}

async function getServerPort(desiredPort: number) {
	// In production, use the exact port specified (fail if taken)
	if (env.NODE_ENV === 'production') {
		return desiredPort
	}

	// In development, find an available port
	const port = await getPort({ port: desiredPort })
	if (port !== desiredPort) {
		console.warn(`⚠️  Port ${desiredPort} was taken, using port ${port} instead`)
	}
	return port
}

const port = await getServerPort(env.PORT)
const server = startServer(port)

const url = `http://${server.hostname}:${server.port}`

setupInteractiveCli(url, server)

// Fire-and-forget cache warming (don't block server startup)
warmMediaCache().catch((error) => {
	console.error('Cache warming failed:', error)
})
