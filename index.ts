// Initialize environment variables
import '#app/config/init-env.ts'

import getPort from 'get-port'
import { getEnv } from '#app/config/env.ts'
import { pruneFeedAnalyticsEvents } from '#app/db/feed-analytics-events.ts'
import { warmMediaCache } from '#app/helpers/media.ts'
import { createAdminRedirectResponse } from '#app/helpers/root-redirect.ts'
import { db } from './app/db/index.ts'
import { migrate } from './app/db/migrations.ts'
import { ensureDefaultClient } from './app/oauth/clients.ts'
import { ensureSigningKey } from './app/oauth/keys.ts'
import router from './app/router.tsx'
import { createBundlingRoutes } from './server/bundling.ts'
import { setupInteractiveCli } from './server/cli.ts'
import { startNodeServer } from './server/node-server.ts'

const env = getEnv()
const rootDir = new URL('.', import.meta.url).pathname

// Initialize database and run migrations
migrate(db)

// Prune old analytics events to keep the event table bounded.
if (env.ANALYTICS_RETENTION_DAYS > 0) {
	const now = Math.floor(Date.now() / 1000)
	const cutoff = now - env.ANALYTICS_RETENTION_DAYS * 24 * 60 * 60
	const deleted = pruneFeedAnalyticsEvents(cutoff)
	if (deleted > 0) {
		console.log(
			`Pruned ${deleted} feed analytics event(s) older than ${env.ANALYTICS_RETENTION_DAYS} day(s).`,
		)
	}
}

// Ensure default OAuth client exists
ensureDefaultClient()

// Initialize OAuth signing key at startup to prevent race conditions
// when multiple concurrent requests arrive before any key exists
await ensureSigningKey()

function startServer(port: number) {
	const bundlingRoutes = createBundlingRoutes(rootDir)
	const bundlingRouteEntries = Object.entries(bundlingRoutes)
	return startNodeServer({
		port,
		async handler(request) {
			try {
				const url = new URL(request.url)
				if (url.pathname === '/') {
					return createAdminRedirectResponse(request)
				}
				for (const [route, bundlingHandler] of bundlingRouteEntries) {
					if (route.includes('*')) {
						const prefix = route.split('*', 1)[0]
						if (prefix && url.pathname.startsWith(prefix)) {
							return await bundlingHandler(request)
						}
						continue
					}
					if (url.pathname === route) {
						return await bundlingHandler(request)
					}
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
const server = await startServer(port)

const url = `http://${server.hostname}:${server.port}`

setupInteractiveCli(url, server)

// Fire-and-forget cache warming (don't block server startup)
warmMediaCache().catch((error) => {
	console.error('Cache warming failed:', error)
})
