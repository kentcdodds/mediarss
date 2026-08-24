import '#app/config/init-env.ts'

import { expect, test } from 'vitest'
import routes from '#app/config/routes.ts'
import { clearDiagnostics, recordDiagnostic } from '#app/helpers/diagnostics.ts'
import {
	DEFAULT_CIMD_PROBE_URL,
	resetCimdProbeState,
	type HealthSnapshot,
} from '#app/helpers/health.ts'
import router from '#app/router.tsx'

function withClearedDiagnostics() {
	clearDiagnostics()
	return {
		[Symbol.dispose]() {
			clearDiagnostics()
			resetCimdProbeState()
		},
	}
}

async function fetchHealth(path: string): Promise<{
	response: Response
	body: HealthSnapshot
}> {
	const response = await router.fetch(new Request(`http://localhost${path}`))
	const body = (await response.json()) as HealthSnapshot
	return { response, body }
}

test('public /health returns commit, runtime, and MCP/OAuth facts', async () => {
	using _diagnostics = withClearedDiagnostics()
	const { response, body } = await fetchHealth(routes.health.href())

	expect(response.status).toBe(200)
	expect(body.status).toBe('ok')
	expect(body.database.ok).toBe(true)
	expect(typeof body.timestamp).toBe('string')
	expect(typeof body.uptimeMs).toBe('number')
	expect(body.node).toMatch(/^v\d+/)
	expect(body.mcp).toEqual({ protocol: '2026-07-28', legacy: 'reject' })
	expect(body.oauth.clientIdMetadataDocumentSupported).toBe(true)
	expect(Array.isArray(body.mediaRoots)).toBe(true)
	expect(Array.isArray(body.diagnostics)).toBe(true)
	expect(body.probes).toBeUndefined()
	expect(body.commit).not.toBeNull()
	expect(body.commit!.sha.length).toBeGreaterThanOrEqual(7)
	expect(body.commit!.short).toBe(body.commit!.sha.slice(0, 7))
	expect(['git', 'env']).toContain(body.commit!.source)
})

test('admin /health shares the public health payload', async () => {
	using _diagnostics = withClearedDiagnostics()
	const { response, body } = await fetchHealth(routes.adminHealth.href())
	expect(response.status).toBe(200)
	expect(body.status).toBe('ok')
	expect(body.mcp.legacy).toBe('reject')
})

test('health includes recent diagnostics from failed authorize/CIMD work', async () => {
	using _diagnostics = withClearedDiagnostics()
	recordDiagnostic({
		area: 'oauth.authorize',
		event: 'client_rejected',
		ok: false,
		detail: { reason: 'Could not resolve Client ID Metadata Document' },
	})
	const { body } = await fetchHealth(routes.health.href())
	expect(
		body.diagnostics.some((event) => event.area === 'oauth.authorize'),
	).toBe(true)
})

test('health ?probe=cimd records an outbound CIMD lookup', async () => {
	using _diagnostics = withClearedDiagnostics()
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input)
		if (url === DEFAULT_CIMD_PROBE_URL) {
			return new Response('blocked', {
				status: 403,
				headers: { 'Content-Type': 'text/plain' },
			})
		}
		return originalFetch(input)
	}) as typeof fetch

	try {
		const { response, body } = await fetchHealth(
			`${routes.health.href()}?probe=cimd`,
		)
		expect(response.status).toBe(503)
		expect(body.status).toBe('error')
		expect(body.probes?.cimd.ok).toBe(false)
		expect(body.probes?.cimd.url).toBe(DEFAULT_CIMD_PROBE_URL)
		expect(body.probes?.cimd.error).toMatch(/403/)
		expect(
			body.diagnostics.some(
				(event) => event.area === 'oauth.cimd' && event.ok === false,
			),
		).toBe(true)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('health ?probe=cimd coalesces overlapping and cooldown lookups', async () => {
	using _diagnostics = withClearedDiagnostics()
	resetCimdProbeState()
	let fetches = 0
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input)
		if (url === DEFAULT_CIMD_PROBE_URL) {
			fetches += 1
			return new Response('blocked', {
				status: 403,
				headers: { 'Content-Type': 'text/plain' },
			})
		}
		return originalFetch(input)
	}) as typeof fetch

	try {
		const [first, second] = await Promise.all([
			fetchHealth(`${routes.health.href()}?probe=cimd`),
			fetchHealth(`${routes.health.href()}?probe=cimd`),
		])
		expect(first.body.probes?.cimd.ok).toBe(false)
		expect(second.body.probes?.cimd.ok).toBe(false)
		const third = await fetchHealth(`${routes.health.href()}?probe=cimd`)
		expect(third.body.probes?.cimd.ok).toBe(false)
		expect(fetches).toBe(1)
	} finally {
		globalThis.fetch = originalFetch
	}
})
