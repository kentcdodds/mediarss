import { describe, expect, test } from 'bun:test'
import {
	getClientFingerprint,
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
