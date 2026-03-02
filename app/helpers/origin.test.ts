import { expect, test } from 'bun:test'
import { getOrigin, getProtocol } from './origin.ts'

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
