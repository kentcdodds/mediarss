import http from 'node:http'
import { type AddressInfo } from 'node:net'
import {
	createRequestListener,
	type FetchHandler,
} from 'remix/node-fetch-server'

export type AppServer = {
	server: http.Server
	hostname: string
	port: number
	stop: (closeIdleConnections?: boolean) => Promise<void>
	[Symbol.dispose]: () => void
	[Symbol.asyncDispose]: () => Promise<void>
}

export async function startNodeServer({
	port,
	hostname = '0.0.0.0',
	handler,
}: {
	port: number
	hostname?: string
	handler: FetchHandler
}): Promise<AppServer> {
	const server = http.createServer(
		createRequestListener(handler, {
			// This app generates public URLs behind reverse proxies, so let Remix
			// normalize request.url from trusted Forwarded/X-Forwarded-* headers.
			trustProxy: true,
			onError(error) {
				console.error(error)
				return new Response('Internal Server Error', { status: 500 })
			},
		}),
	)

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, hostname, () => {
			server.off('error', reject)
			resolve()
		})
	})

	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Failed to determine server address')
	}

	const addressInfo = address as AddressInfo

	return {
		server,
		hostname: addressInfo.address,
		port: addressInfo.port,
		[Symbol.dispose]: () => {
			server.closeIdleConnections?.()
			server.close()
		},
		[Symbol.asyncDispose]: async () => {
			server.closeIdleConnections?.()
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}
					resolve()
				})
			})
		},
		stop: async (closeIdleConnections = true) => {
			if (closeIdleConnections) {
				server.closeIdleConnections?.()
			}
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}
					resolve()
				})
			})
		},
	}
}
