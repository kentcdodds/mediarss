import dns from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'

/**
 * NAS Docker bridges often have broken IPv6 or hung AAAA lookups.
 * Node defaults to `verbatim` result order, so a dual-stack host
 * (Cloudflare) can sit on a dead AAAA path until AbortSignal fires.
 */
export const OUTBOUND_IP_FAMILY = 4 as const

const MAX_REDIRECTS = 5
const nativeFetch = globalThis.fetch

export function configureOutboundNetwork(): void {
	dns.setDefaultResultOrder('ipv4first')
}

export function getOutboundRequestOptions(url: string): https.RequestOptions {
	const parsed = new URL(url)
	return {
		protocol: parsed.protocol,
		hostname: parsed.hostname,
		port: parsed.port || undefined,
		path: `${parsed.pathname}${parsed.search}`,
		family: OUTBOUND_IP_FAMILY,
		servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
	}
}

export async function fetchOutbound(
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	if (globalThis.fetch !== nativeFetch) {
		return globalThis.fetch(url, init)
	}
	return fetchIpv4(url, init)
}

async function fetchIpv4(url: string, init: RequestInit): Promise<Response> {
	let current = url
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		const response = await requestIpv4(current, init)
		if (response.status < 300 || response.status >= 400) {
			return response
		}
		const location = response.headers.get('location')
		if (!location) {
			return response
		}
		const next = new URL(location, current).toString()
		if (current.startsWith('https:') && next.startsWith('http:')) {
			throw new Error(`Refusing HTTP redirect from ${current} to ${next}`)
		}
		current = next
	}
	throw new Error(`Too many redirects fetching ${url}`)
}

function headerRecord(init: RequestInit): http.OutgoingHttpHeaders {
	const headers: http.OutgoingHttpHeaders = {}
	new Headers(init.headers).forEach((value, key) => {
		headers[key] = value
	})
	return headers
}

function incomingToResponse(res: IncomingMessage, body: Buffer): Response {
	const headers = new Headers()
	for (const [key, value] of Object.entries(res.headers)) {
		if (value === undefined) continue
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item)
			continue
		}
		headers.set(key, value)
	}
	return new Response(Uint8Array.from(body), {
		status: res.statusCode ?? 0,
		statusText: res.statusMessage,
		headers,
	})
}

function requestIpv4(url: string, init: RequestInit): Promise<Response> {
	return new Promise((resolve, reject) => {
		const transport = new URL(url).protocol === 'https:' ? https : http
		let settled = false
		const finish = (error?: Error, response?: Response) => {
			if (settled) return
			settled = true
			init.signal?.removeEventListener('abort', onAbort)
			if (error) reject(error)
			else resolve(response!)
		}
		const onAbort = () => {
			const error = new Error('The operation was aborted due to timeout')
			error.name = 'AbortError'
			req.destroy()
			finish(error)
		}

		const req = transport.request(
			{
				...getOutboundRequestOptions(url),
				method: init.method ?? 'GET',
				headers: headerRecord(init),
			},
			(res) => {
				const chunks: Array<Buffer> = []
				res.on('data', (chunk: Buffer) => {
					chunks.push(chunk)
				})
				res.on('end', () => {
					finish(undefined, incomingToResponse(res, Buffer.concat(chunks)))
				})
				res.on('error', (error) => {
					finish(error)
				})
			},
		)

		if (init.signal?.aborted) {
			onAbort()
			return
		}
		init.signal?.addEventListener('abort', onAbort, { once: true })
		req.on('error', (error) => {
			finish(error)
		})
		req.end()
	})
}
