import { expect, test } from 'bun:test'
import {
	getClientFingerprint,
	getClientIp,
	getClientName,
	getResponseBytesServed,
	getUserAgent,
	isDownloadStartRequest,
	isTrackableMediaStatus,
	isTrackableRssStatus,
} from './analytics-request.ts'

function createRequest(headers: Record<string, string> = {}) {
	return new Request('https://example.com/feed', { headers })
}

test('getClientIp prefers X-Forwarded-For over Forwarded and X-Real-IP', () => {
	const request = createRequest({
		'X-Forwarded-For': 'unknown, 203.0.113.10',
		Forwarded: 'for=198.51.100.20;proto=https',
		'X-Real-IP': '198.51.100.30',
	})

	expect(getClientIp(request)).toBe('203.0.113.10')
})

test('getClientIp falls back to Forwarded when X-Forwarded-For is invalid', () => {
	const request = createRequest({
		'X-Forwarded-For': 'unknown, nonsense',
		Forwarded: 'for=198.51.100.21;proto=https',
		'X-Real-IP': '198.51.100.31',
	})

	expect(getClientIp(request)).toBe('198.51.100.21')
})

test('getClientIp falls back to X-Real-IP when others are invalid', () => {
	const request = createRequest({
		'X-Forwarded-For': 'unknown, nonsense',
		Forwarded: 'for=unknown;proto=https',
		'X-Real-IP': '"198.51.100.32:8443"',
	})

	expect(getClientIp(request)).toBe('198.51.100.32')
})

test('getClientIp normalizes mapped IPv6 addresses to stable IPv4', () => {
	const dotted = createRequest({
		'X-Forwarded-For': '[::ffff:203.0.113.44]:443',
	})
	const hexadecimal = createRequest({
		'X-Forwarded-For': '[::ffff:cb00:712c]:443',
	})

	expect(getClientIp(dotted)).toBe('203.0.113.44')
	expect(getClientIp(hexadecimal)).toBe('203.0.113.44')
})

test('getClientIp returns null when all proxy headers are unusable', () => {
	const request = createRequest({
		'X-Forwarded-For': 'unknown, nonsense',
		Forwarded: 'for=unknown;proto=https',
		'X-Real-IP': 'unknown',
	})

	expect(getClientIp(request)).toBeNull()
})

test('getUserAgent returns trimmed value', () => {
	const request = createRequest({
		'User-Agent': '  Pocket Casts/7.58  ',
	})

	expect(getUserAgent(request)).toBe('Pocket Casts/7.58')
})

test('getClientName maps known clients and tokenizes unknown clients', () => {
	expect(
		getClientName(
			createRequest({
				'User-Agent': 'Pocket Casts/7.58',
			}),
		),
	).toBe('Pocket Casts')

	expect(
		getClientName(
			createRequest({
				'User-Agent': 'CustomPodClient/1.2 (Linux)',
			}),
		),
	).toBe('CustomPodClient/1.2')
})

test('getClientName returns null with missing user agent', () => {
	expect(getClientName(createRequest())).toBeNull()
})

test('getClientFingerprint is stable for equivalent canonical client traits', () => {
	const fingerprintFromNoisyHeaders = getClientFingerprint(
		createRequest({
			'X-Forwarded-For': '"203.0.113.50:443"',
			'User-Agent': 'Pocket Casts/7.58',
		}),
	)
	const fingerprintFromCanonicalHeaders = getClientFingerprint(
		createRequest({
			'X-Forwarded-For': '203.0.113.50',
			'User-Agent': 'Pocket Casts/7.58',
		}),
	)

	expect(fingerprintFromNoisyHeaders).toBeTruthy()
	expect(fingerprintFromNoisyHeaders).toBe(fingerprintFromCanonicalHeaders)
})

test('getClientFingerprint falls back to user-agent when IP is unavailable', () => {
	const userAgentOnlyFingerprint = getClientFingerprint(
		createRequest({
			'X-Forwarded-For': 'unknown',
			Forwarded: 'for=unknown',
			'X-Real-IP': 'unknown',
			'User-Agent': 'CustomPodClient/1.2 (Linux)',
		}),
	)
	const equivalentFallbackFingerprint = getClientFingerprint(
		createRequest({
			'User-Agent': 'CustomPodClient/1.2 (Linux)',
		}),
	)

	expect(userAgentOnlyFingerprint).toBeTruthy()
	expect(userAgentOnlyFingerprint).toBe(equivalentFallbackFingerprint)
})

test('getClientFingerprint returns null when no identifying traits are present', () => {
	expect(getClientFingerprint(createRequest())).toBeNull()
})

test('isDownloadStartRequest identifies full and range-start requests', () => {
	expect(isDownloadStartRequest(createRequest())).toBe(true)
	expect(
		isDownloadStartRequest(
			createRequest({
				Range: 'bytes=0-',
			}),
		),
	).toBe(true)
	expect(
		isDownloadStartRequest(
			createRequest({
				Range: 'bytes=10-',
			}),
		),
	).toBe(false)
	expect(
		isDownloadStartRequest(
			createRequest({
				Range: 'nonsense',
			}),
		),
	).toBe(false)
})

test('getResponseBytesServed parses valid content length and ignores invalid values', () => {
	expect(
		getResponseBytesServed(
			new Response(null, {
				headers: {
					'Content-Length': '1234',
				},
			}),
		),
	).toBe(1234)

	expect(
		getResponseBytesServed(
			new Response(null, {
				headers: {
					'Content-Length': '-1',
				},
			}),
		),
	).toBeNull()

	expect(getResponseBytesServed(new Response(null))).toBeNull()
})

test('trackable status helpers accept only expected statuses', () => {
	expect(isTrackableRssStatus(200)).toBe(true)
	expect(isTrackableRssStatus(206)).toBe(false)

	expect(isTrackableMediaStatus(200)).toBe(true)
	expect(isTrackableMediaStatus(206)).toBe(true)
	expect(isTrackableMediaStatus(404)).toBe(false)
})
