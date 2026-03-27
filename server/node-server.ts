import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequestListener, type FetchHandler } from 'remix/node-fetch-server'

export type AppServer = {
	server: http.Server
	hostname: string
	port: number
	stop: (closeIdleConnections?: boolean) => Promise<void>
}

export async function startNodeServer({
	port,
	hostname = '127.0.0.1',
	handler,
}: {
	port: number
	hostname?: string
	handler: FetchHandler
}): Promise<AppServer> {
	const server = http.createServer(
		createRequestListener(handler, {
			host: hostname,
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
