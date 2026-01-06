// Initialize environment variables
import '#app/config/init-env.ts'

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

function tryStartServer(desiredPort: number, maxAttempts = 10) {
	let port = desiredPort

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const server = startServer(port)
			if (port !== desiredPort) {
				console.warn(
					`⚠️  Port ${desiredPort} was taken, using port ${port} instead`,
				)
			}
			return server
		} catch (error) {
			const isPortTaken =
				error instanceof Error &&
				(error.message.includes('EADDRINUSE') ||
					error.message.includes('address already in use'))

			if (!isPortTaken) {
				throw error
			}

			// In production, fail immediately if port is taken
			if (env.NODE_ENV === 'production') {
				throw new Error(
					`Port ${desiredPort} is already in use. In production, the server will not automatically find an alternative port.`,
				)
			}

			port++
		}
	}

	throw new Error(
		`Could not find an available port after ${maxAttempts} attempts (tried ${desiredPort}-${desiredPort + maxAttempts - 1})`,
	)
}

const server = tryStartServer(env.PORT)

const url = `http://${server.hostname}:${server.port}`

setupInteractiveCli(url)

// Fire-and-forget cache warming (don't block server startup)
warmMediaCache().catch((error) => {
	console.error('Cache warming failed:', error)
})
