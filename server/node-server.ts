import http from 'node:http'
import { type AddressInfo } from 'node:net'
import {
	createRequest,
	type FetchHandler,
	sendResponse,
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
	const server = http.createServer(async (req, res) => {
		try {
			const request = createRequest(req, res)
			const client = {
				address: req.socket.remoteAddress ?? '127.0.0.1',
				family: (req.socket.remoteFamily as 'IPv4' | 'IPv6') ?? 'IPv4',
				port: req.socket.remotePort ?? 0,
			}
			const response = await handler(request, client)
			await sendResponse(res, response)
		} catch (error) {
			console.error(error)
			if (!res.headersSent) {
				res.statusCode = 500
				res.end('Internal Server Error')
			} else {
				res.destroy()
			}
		}
	})

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
