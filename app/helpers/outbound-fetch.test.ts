import '#app/config/init-env.ts'

import dns from 'node:dns'
import http from 'node:http'
import { expect, test } from 'vitest'
import {
	configureOutboundNetwork,
	fetchOutbound,
	getOutboundRequestOptions,
	OUTBOUND_IP_FAMILY,
} from './outbound-fetch.ts'

test('outbound CIMD requests prefer IPv4', () => {
	configureOutboundNetwork()
	expect(dns.getDefaultResultOrder()).toBe('ipv4first')
	expect(OUTBOUND_IP_FAMILY).toBe(4)
	expect(
		getOutboundRequestOptions('https://kody.codes/oauth/client-metadata.json'),
	).toMatchObject({
		hostname: 'kody.codes',
		family: 4,
		servername: 'kody.codes',
	})
})

test('fetchOutbound uses a mocked global fetch', async () => {
	const originalFetch = globalThis.fetch
	let called = 0
	globalThis.fetch = (async () => {
		called += 1
		return new Response('mocked', { status: 200 })
	}) as typeof fetch
	try {
		const response = await fetchOutbound('https://example.com/metadata')
		expect(called).toBe(1)
		expect(await response.text()).toBe('mocked')
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('fetchOutbound talks to an IPv4 HTTP server', async () => {
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ ok: true }))
	})
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('expected TCP address')
	}
	try {
		const response = await fetchOutbound(
			`http://127.0.0.1:${address.port}/metadata`,
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()))
		})
	}
})
