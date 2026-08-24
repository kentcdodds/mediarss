import { expect, test } from 'vitest'
import {
	clearDiagnostics,
	getRecentDiagnostics,
	recordDiagnostic,
} from './diagnostics.ts'

test('recordDiagnostic keeps a recent ring buffer and structured events', () => {
	clearDiagnostics()
	recordDiagnostic({
		area: 'oauth.cimd',
		event: 'fetch_failed',
		ok: false,
		durationMs: 12,
		detail: { url: 'https://example.com/metadata', httpStatus: 403 },
	})
	recordDiagnostic({
		area: 'mcp',
		event: 'unauthorized',
		ok: false,
	})

	const events = getRecentDiagnostics()
	expect(events).toHaveLength(2)
	expect(events[0]).toMatchObject({
		area: 'oauth.cimd',
		event: 'fetch_failed',
		ok: false,
		detail: { httpStatus: 403 },
	})
	expect(typeof events[0]?.at).toBe('string')
	clearDiagnostics()
	expect(getRecentDiagnostics()).toEqual([])
})
