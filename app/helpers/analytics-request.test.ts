import { describe, expect, test } from 'bun:test'
import {
	getClientFingerprint,
	getClientIp,
	getClientName,
	getResponseBytesServed,
	isDownloadStartRequest,
	isTrackableMediaStatus,
	isTrackableRssStatus,
} from './analytics-request.ts'

describe('analytics-request helpers', () => {
	test('creates stable fingerprints from request headers', () => {
		const requestA = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.10',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		const requestB = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.10',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		const requestC = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(requestA)).toBe(getClientFingerprint(requestB))
		expect(getClientFingerprint(requestA)).not.toBe(
			getClientFingerprint(requestC),
		)
	})

	test('returns null fingerprint when no client traits are available', () => {
		const request = new Request('https://example.com/media')
		expect(getClientFingerprint(request)).toBeNull()
	})

	test('builds fingerprint from X-Real-IP when forwarded-for is absent', () => {
		const requestA = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.9',
			},
		})
		const requestB = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.9',
			},
		})

		expect(getClientFingerprint(requestA)).toBeTruthy()
		expect(getClientFingerprint(requestA)).toBe(getClientFingerprint(requestB))
	})

	test('trims X-Real-IP and ignores blank values', () => {
		const trimmedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': ' 198.51.100.9 ',
			},
		})
		const blankRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '   ',
			},
		})

		expect(getClientIp(trimmedRequest)).toBe('198.51.100.9')
		expect(getClientIp(blankRequest)).toBeNull()
	})

	test('uses first X-Forwarded-For address for fingerprinting', () => {
		const requestA = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.5, 198.51.100.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const requestB = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.5',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(requestA)).toBe(getClientFingerprint(requestB))
	})

	test('skips blank forwarded entries before falling back to real values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '  , 203.0.113.19, 198.51.100.12',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.19')
	})

	test('skips unknown forwarded entries and picks first valid IP', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'unknown, 203.0.113.21, 198.51.100.12',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.21')
	})

	test('falls back to X-Real-IP when forwarded entries are unknown', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'unknown,  ',
				'X-Real-IP': '198.51.100.44',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.44')
	})

	test('falls back to X-Real-IP when forwarded entries are unknown with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'unknown:8443, unknown',
				'X-Real-IP': '198.51.100.45',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.45')
	})

	test('normalizes quoted forwarded and real IP values', () => {
		const forwardedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"203.0.113.33", 198.51.100.12',
			},
		})
		const realIpRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"unknown", ',
				'X-Real-IP': '"198.51.100.99"',
			},
		})

		expect(getClientIp(forwardedRequest)).toBe('203.0.113.33')
		expect(getClientIp(realIpRequest)).toBe('198.51.100.99')
	})

	test('uses standardized Forwarded header when X-Forwarded-For is missing', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=203.0.113.60;proto=https;by=203.0.113.43',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.60')
	})

	test('uses Forwarded header when X-Forwarded-For values are all unknown', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'unknown, unknown:8443',
				Forwarded: 'for=203.0.113.61;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.61')
	})

	test('skips unknown Forwarded for values and uses next candidate', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=unknown, for="198.51.100.77";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.77')
	})

	test('falls back to X-Real-IP when Forwarded values are unknown', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=unknown, for=_hidden',
				'X-Real-IP': '198.51.100.120',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.120')
	})

	test('falls back to X-Real-IP when Forwarded unknown values include ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=unknown:4711, for=unknown',
				'X-Real-IP': '198.51.100.122',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.122')
	})

	test('normalizes forwarded IPv4 values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=198.51.100.77:8443;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.77')
	})

	test('normalizes X-Forwarded-For IPv4 values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.78:8080',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.78')
	})

	test('normalizes quoted forwarded IPv6 values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[2001:db8:cafe::17]:4711";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('2001:db8:cafe::17')
	})

	test('skips malformed bracketed Forwarded IPv6 values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[2001:db8:cafe::17", for=198.51.100.81',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.81')
	})

	test('skips bracketed Forwarded IPv6 values with invalid suffixes', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[2001:db8:cafe::17]oops", for=198.51.100.82',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.82')
	})

	test('skips obfuscated Forwarded for values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=_hidden, for=198.51.100.77',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.77')
	})

	test('parses Forwarded for keys case-insensitively', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'FoR=198.51.100.79;PrOtO=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.79')
	})

	test('skips empty quoted Forwarded values and uses next candidate', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="", for=198.51.100.80',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.80')
	})

	test('skips malformed quoted Forwarded values containing commas', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown,proxy", for=198.51.100.83',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.83')
	})

	test('ignores empty quoted X-Real-IP values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '""',
			},
		})

		expect(getClientIp(request)).toBeNull()
	})

	test('prefers X-Forwarded-For over Forwarded header values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.88',
				Forwarded: 'for=198.51.100.77;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.88')
	})

	test('prefers X-Forwarded-For over X-Real-IP for fingerprinting', () => {
		const requestA = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.5',
				'X-Real-IP': '198.51.100.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const requestB = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.5',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const requestC = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(requestA)).toBe(getClientFingerprint(requestB))
		expect(getClientFingerprint(requestA)).not.toBe(
			getClientFingerprint(requestC),
		)
	})

	test('extracts known podcast client names from user agent', () => {
		const request = new Request('https://example.com/feed', {
			headers: {
				'User-Agent': 'AppleCoreMedia/1.0.0.20B82',
			},
		})

		expect(getClientName(request)).toBe('AppleCoreMedia')
	})

	test('falls back to first user-agent token for unknown clients', () => {
		const request = new Request('https://example.com/feed', {
			headers: {
				'User-Agent': 'CustomPodApp/2.4 (Linux)',
			},
		})

		expect(getClientName(request)).toBe('CustomPodApp/2.4')
	})

	test('returns null client name when user-agent is blank', () => {
		const request = new Request('https://example.com/feed', {
			headers: {
				'User-Agent': '   ',
			},
		})

		expect(getClientName(request)).toBeNull()
	})

	test('detects download-start requests from range headers', () => {
		const fullRequest = new Request('https://example.com/media')
		const zeroRangeRequest = new Request('https://example.com/media', {
			headers: {
				Range: 'bytes=0-',
			},
		})
		const offsetRangeRequest = new Request('https://example.com/media', {
			headers: {
				Range: 'bytes=1024-',
			},
		})
		const malformedRangeRequest = new Request('https://example.com/media', {
			headers: {
				Range: 'bytes=-500',
			},
		})
		const invalidUnitRangeRequest = new Request('https://example.com/media', {
			headers: {
				Range: 'items=0-100',
			},
		})

		expect(isDownloadStartRequest(fullRequest)).toBe(true)
		expect(isDownloadStartRequest(zeroRangeRequest)).toBe(true)
		expect(isDownloadStartRequest(offsetRangeRequest)).toBe(false)
		expect(isDownloadStartRequest(malformedRangeRequest)).toBe(false)
		expect(isDownloadStartRequest(invalidUnitRangeRequest)).toBe(false)
	})

	test('reads bytes served from content-length header', () => {
		const response = new Response(null, {
			status: 206,
			headers: {
				'Content-Length': '12345',
			},
		})

		expect(getResponseBytesServed(response)).toBe(12345)
		expect(getResponseBytesServed(new Response())).toBeNull()
		expect(
			getResponseBytesServed(
				new Response(null, {
					headers: {
						'Content-Length': '-10',
					},
				}),
			),
		).toBeNull()
		expect(
			getResponseBytesServed(
				new Response(null, {
					headers: {
						'Content-Length': 'not-a-number',
					},
				}),
			),
		).toBeNull()
	})

	test('tracks expected RSS and media statuses', () => {
		expect(isTrackableRssStatus(200)).toBe(true)
		expect(isTrackableRssStatus(304)).toBe(false)
		expect(isTrackableMediaStatus(200)).toBe(true)
		expect(isTrackableMediaStatus(206)).toBe(true)
		expect(isTrackableMediaStatus(404)).toBe(false)
	})
})
