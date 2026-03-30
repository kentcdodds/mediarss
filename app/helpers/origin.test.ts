import http from 'node:http'
import { expect, test } from 'vitest'
import { startNodeServer } from '../../server/node-server.ts'
import { getOrigin, getProtocol } from './origin.ts'
import {
	createAdminRedirectResponse,
	getAdminRedirectUrl,
} from './root-redirect.ts'

test('getProtocol prefers x-forwarded-proto when present', () => {
	const request = new Request('http://mediarss.doddsfamily.us/mcp', {
		headers: {
			'X-Forwarded-Proto': 'https, http',
			Forwarded: 'for=198.51.100.1;proto=http',
		},
	})

	const protocol = getProtocol(request, new URL(request.url))
	expect(protocol).toBe('https:')
})

test('getProtocol uses forwarded proto parameter when x-forwarded-proto is absent', () => {
	const request = new Request('http://mediarss.doddsfamily.us/mcp', {
		headers: {
			Forwarded: 'for=198.51.100.1;host=mediarss.doddsfamily.us;proto=https',
		},
	})

	const protocol = getProtocol(request, new URL(request.url))
	expect(protocol).toBe('https:')
})

test('getProtocol supports quoted and uppercase proto values in Forwarded', () => {
	const request = new Request('http://mediarss.doddsfamily.us/mcp', {
		headers: {
			Forwarded: 'for=198.51.100.1;proto="HTTPS"',
		},
	})

	const protocol = getProtocol(request, new URL(request.url))
	expect(protocol).toBe('https:')
})

test('getOrigin falls back to request protocol without proxy headers', () => {
	const request = new Request('http://localhost:22050/mcp')
	const origin = getOrigin(request, new URL(request.url))
	expect(origin).toBe('http://localhost:22050')
})

test('getOrigin prefers Forwarded host when proxy rewrites request host', () => {
	const request = new Request('http://internal-service:3000/mcp', {
		headers: {
			Forwarded: 'for=198.51.100.1;host=mediarss.doddsfamily.us;proto=https',
		},
	})
	const origin = getOrigin(request, new URL(request.url))
	expect(origin).toBe('https://mediarss.doddsfamily.us')
})

test('getOrigin prefers X-Forwarded-Host over request URL host', () => {
	const request = new Request('http://internal-service:3000/mcp', {
		headers: {
			'X-Forwarded-Proto': 'https',
			'X-Forwarded-Host': 'mediarss.doddsfamily.us',
		},
	})
	const origin = getOrigin(request, new URL(request.url))
	expect(origin).toBe('https://mediarss.doddsfamily.us')
})

test('getAdminRedirectUrl prefers forwarded public origin', () => {
	const request = new Request('http://internal-service:22050/', {
		headers: {
			'X-Forwarded-Proto': 'https',
			'X-Forwarded-Host': 'mediarss.doddsfamily.us',
		},
	})

	expect(getAdminRedirectUrl(request).toString()).toBe(
		'https://mediarss.doddsfamily.us/admin',
	)
})

test('root redirect preserves incoming host on the node server', async () => {
	await using server = await startNodeServer({
		port: 0,
		async handler(request) {
			return createAdminRedirectResponse(request)
		},
	})

	const response = await new Promise<{
		statusCode: number | undefined
		location: string | string[] | undefined
	}>((resolve, reject) => {
		const request = http.request(
			{
				hostname: '127.0.0.1',
				port: server.port,
				path: '/',
				method: 'GET',
				headers: {
					Host: 'mediarss.doddsfamily.us',
				},
			},
			(response) => {
				resolve({
					statusCode: response.statusCode,
					location: response.headers.location,
				})
			},
		)

		request.on('error', reject)
		request.end()
	})

	expect(response.statusCode).toBe(302)
	expect(response.location).toBe('http://mediarss.doddsfamily.us/admin')
})
