import { describe, expect, test } from 'bun:test'
import {
	crossHeaderForwardedValues,
	crossHeaderXForwardedForValues,
	crossHeaderXRealIpValues,
	repeatedForwardedForHeaderBuilders,
	repeatedForwardedForValues,
} from './analytics-header-precedence-matrix.ts'
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

	test('returns null fingerprint when client IP headers contain only invalid values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'proxy.internal, app.server',
				Forwarded: 'for=unknown',
				'X-Real-IP': '_hidden',
			},
		})

		expect(getClientIp(request)).toBeNull()
		expect(getClientFingerprint(request)).toBeNull()
	})

	test('builds fingerprint from user-agent when client IP headers are invalid', () => {
		const requestWithInvalidIpHeaders = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': 'proxy.internal, app.server',
					Forwarded: 'for=unknown',
					'X-Real-IP': '_hidden',
					'User-Agent': 'Pocket Casts/7.0',
				},
			},
		)
		const requestWithUserAgentOnly = new Request('https://example.com/media', {
			headers: {
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientIp(requestWithInvalidIpHeaders)).toBeNull()
		expect(getClientFingerprint(requestWithInvalidIpHeaders)).toBe(
			getClientFingerprint(requestWithUserAgentOnly),
		)
		expect(getClientFingerprint(requestWithInvalidIpHeaders)).toBeTruthy()
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

	test('normalizes X-Real-IP values with ports', () => {
		const ipv4WithPortRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.47:8443',
			},
		})
		const bracketedIpv6WithPortRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '[2001:db8:cafe::51]:443',
				},
			},
		)
		const invalidPortRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.47:abc',
			},
		})

		expect(getClientIp(ipv4WithPortRequest)).toBe('198.51.100.47')
		expect(getClientIp(bracketedIpv6WithPortRequest)).toBe('2001:db8:cafe::51')
		expect(getClientIp(invalidPortRequest)).toBeNull()
	})

	test('normalizes quoted X-Real-IP values with ports', () => {
		const quotedIpv4WithPortRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '"198.51.100.48:8443"',
			},
		})
		const quotedBracketedIpv6WithPortRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '"[2001:DB8:CAFE::63]:443"',
				},
			},
		)

		expect(getClientIp(quotedIpv4WithPortRequest)).toBe('198.51.100.48')
		expect(getClientIp(quotedBracketedIpv6WithPortRequest)).toBe(
			'2001:db8:cafe::63',
		)
	})

	test('uses first valid value from comma-separated X-Real-IP headers', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': 'unknown, "198.51.100.57:8443", 198.51.100.58',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.57')
	})

	test('returns null when comma-separated X-Real-IP values are all invalid', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': 'unknown, proxy.internal, "198.51.100.59:abc"',
			},
		})

		expect(getClientIp(request)).toBeNull()
	})

	test('parses quoted whole-chain X-Real-IP values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '"unknown, 198.51.100.60:8443"',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.60')
	})

	test('parses escaped-quote whole-chain X-Real-IP values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '"\\"unknown\\", 198.51.100.223:8443"',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.223')
	})

	test('recovers from malformed quoted X-Real-IP chains', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '"unknown, 198.51.100.212, 198.51.100.213',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.212')
	})

	test('recovers from malformed escaped-quote X-Real-IP chains', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '"\\"unknown\\", 198.51.100.225:8443',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.225')
	})

	test('recovers escaped-quote chains with repeated trailing quotes in X-Real-IP values', () => {
		const repeatedTrailingQuoteEscapedChainRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '"\\"unknown\\", 198.51.100.255\\"\\"',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.255',
			},
		})

		expect(getClientIp(repeatedTrailingQuoteEscapedChainRequest)).toBe(
			'198.51.100.255',
		)
		expect(getClientFingerprint(repeatedTrailingQuoteEscapedChainRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers dangling trailing quotes in X-Real-IP values', () => {
		const danglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '198.51.100.250"',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.250',
			},
		})

		expect(getClientIp(danglingTrailingQuoteRequest)).toBe('198.51.100.250')
		expect(getClientFingerprint(danglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling trailing quotes in X-Real-IP values', () => {
		const repeatedDanglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '198.51.100.253""',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.253',
			},
		})

		expect(getClientIp(repeatedDanglingTrailingQuoteRequest)).toBe(
			'198.51.100.253',
		)
		expect(getClientFingerprint(repeatedDanglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers dangling leading quotes in X-Real-IP values', () => {
		const danglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '"198.51.100.251',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.251',
			},
		})

		expect(getClientIp(danglingLeadingQuoteRequest)).toBe('198.51.100.251')
		expect(getClientFingerprint(danglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling leading quotes in X-Real-IP values', () => {
		const repeatedDanglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Real-IP': '""198.51.100.254',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.254',
			},
		})

		expect(getClientIp(repeatedDanglingLeadingQuoteRequest)).toBe(
			'198.51.100.254',
		)
		expect(getClientFingerprint(repeatedDanglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('preserves first valid X-Real-IP candidate across segment combination matrix', () => {
		const realIpSegments = [
			'198.51.100.251',
			'"198.51.100.252"',
			'[2001:db8::99]:443',
			'"[2001:db8::9a]:443"',
			'unknown',
			'"unknown"',
			'_hidden',
			'nonsense',
			'"\\"unknown\\", 198.51.100.254"',
			'198.51.100.255:8080',
		]

		const segmentCombinations: string[][] = []
		for (const first of realIpSegments) {
			segmentCombinations.push([first])
			for (const second of realIpSegments) {
				segmentCombinations.push([first, second])
				for (const third of realIpSegments) {
					segmentCombinations.push([first, second, third])
				}
			}
		}

		for (const segmentCombination of segmentCombinations) {
			const realIpHeader = segmentCombination.join(',')
			const request = new Request('https://example.com/media', {
				headers: {
					'X-Real-IP': realIpHeader,
				},
			})

			let expectedIp: string | null = null
			for (const segment of segmentCombination) {
				const isolatedSegmentRequest = new Request(
					'https://example.com/media',
					{
						headers: {
							'X-Real-IP': segment,
						},
					},
				)
				const isolatedIp = getClientIp(isolatedSegmentRequest)
				if (isolatedIp) {
					expectedIp = isolatedIp
					break
				}
			}

			expect(getClientIp(request)).toBe(expectedIp)
		}
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

	test('parses quoted whole-chain X-Forwarded-For values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"203.0.113.201, 198.51.100.201"',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.201')
	})

	test('parses escaped-quote whole-chain X-Forwarded-For values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.223"',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.223')
	})

	test('recovers from malformed quoted X-Forwarded-For chains', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"unknown, 203.0.113.210, 198.51.100.210',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.210')
	})

	test('recovers from malformed escaped-quote X-Forwarded-For chains', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.234',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.234')
	})

	test('recovers escaped-quote chains with repeated trailing quotes in X-Forwarded-For values', () => {
		const repeatedTrailingQuoteEscapedChainRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': '"\\"unknown\\", 203.0.113.255\\"\\"',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.255',
			},
		})

		expect(getClientIp(repeatedTrailingQuoteEscapedChainRequest)).toBe(
			'203.0.113.255',
		)
		expect(getClientFingerprint(repeatedTrailingQuoteEscapedChainRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers dangling trailing quotes in X-Forwarded-For chains', () => {
		const danglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': 'unknown, 203.0.113.250"',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.250',
			},
		})

		expect(getClientIp(danglingTrailingQuoteRequest)).toBe('203.0.113.250')
		expect(getClientFingerprint(danglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling trailing quotes in X-Forwarded-For chains', () => {
		const repeatedDanglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': 'unknown, 203.0.113.253""',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.253',
			},
		})

		expect(getClientIp(repeatedDanglingTrailingQuoteRequest)).toBe(
			'203.0.113.253',
		)
		expect(getClientFingerprint(repeatedDanglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers dangling leading quotes in X-Forwarded-For chains', () => {
		const danglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': '"unknown, 203.0.113.251',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.251',
			},
		})

		expect(getClientIp(danglingLeadingQuoteRequest)).toBe('203.0.113.251')
		expect(getClientFingerprint(danglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling leading quotes in X-Forwarded-For chains', () => {
		const repeatedDanglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': '""unknown, 203.0.113.254',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.254',
			},
		})

		expect(getClientIp(repeatedDanglingLeadingQuoteRequest)).toBe(
			'203.0.113.254',
		)
		expect(getClientFingerprint(repeatedDanglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('preserves first valid X-Forwarded-For candidate across segment combination matrix', () => {
		const forwardedSegments = [
			'198.51.100.241',
			'"198.51.100.242"',
			'[2001:db8::88]:443',
			'"[2001:db8::89]:443"',
			'unknown',
			'"unknown"',
			'_hidden',
			'nonsense',
			'"\\"unknown\\", 198.51.100.244"',
			'198.51.100.245:8080',
		]

		const segmentCombinations: string[][] = []
		for (const first of forwardedSegments) {
			segmentCombinations.push([first])
			for (const second of forwardedSegments) {
				segmentCombinations.push([first, second])
				for (const third of forwardedSegments) {
					segmentCombinations.push([first, second, third])
				}
			}
		}

		for (const segmentCombination of segmentCombinations) {
			const forwardedHeader = segmentCombination.join(',')
			const request = new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': forwardedHeader,
				},
			})

			let expectedIp: string | null = null
			for (const segment of segmentCombination) {
				const isolatedSegmentRequest = new Request(
					'https://example.com/media',
					{
						headers: {
							'X-Forwarded-For': segment,
						},
					},
				)
				const isolatedIp = getClientIp(isolatedSegmentRequest)
				if (isolatedIp) {
					expectedIp = isolatedIp
					break
				}
			}

			expect(getClientIp(request)).toBe(expectedIp)
		}
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

	test('falls back to X-Real-IP when X-Forwarded-For values are not IPs', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'not-an-ip, also-not-an-ip',
				'X-Real-IP': '198.51.100.46',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.46')
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

	test('parses quoted whole-chain Forwarded for values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown, 203.0.113.206";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.206')
	})

	test('parses quoted whole-chain Forwarded for values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown, 198.51.100.206:8443";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.206')
	})

	test('parses escaped-quote whole-chain Forwarded for values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="\\"unknown\\", 198.51.100.224:8443";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.224')
	})

	test('recovers from malformed quoted Forwarded for chains', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded:
					'for="unknown, 203.0.113.214, for=198.51.100.214;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.214')
	})

	test('recovers malformed Forwarded quoted for chains split before proto segment', () => {
		const malformedRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="""unknown", 198.51.100.236;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.236',
			},
		})

		expect(getClientIp(malformedRequest)).toBe('198.51.100.236')
		expect(getClientFingerprint(malformedRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers malformed Forwarded quoted for chains split without whitespace before proto segment', () => {
		const malformedRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="""unknown",198.51.100.239;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.239',
			},
		})

		expect(getClientIp(malformedRequest)).toBe('198.51.100.239')
		expect(getClientFingerprint(malformedRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('falls through malformed Forwarded first segment to later valid for candidate', () => {
		const malformedThenValidRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="""unknown",proto=https,for=198.51.100.240;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.240',
			},
		})

		expect(getClientIp(malformedThenValidRequest)).toBe('198.51.100.240')
		expect(getClientFingerprint(malformedThenValidRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('keeps earliest valid Forwarded candidate when bare malformed segment follows', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded:
					'for=198.51.100.201, nonsense,for=198.51.100.202;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.201',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.201')
		expect(getClientFingerprint(request)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('keeps earliest valid quoted Forwarded candidate when bare malformed segment follows', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded:
					'for="198.51.100.211", nonsense,for=198.51.100.212;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.211',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.211')
		expect(getClientFingerprint(request)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('preserves first valid Forwarded candidate across segment combination matrix', () => {
		const forwardedSegments = [
			'for=198.51.100.10;proto=https',
			'for="198.51.100.11";proto=https',
			'for=unknown;proto=https',
			'for="unknown";proto=https',
			'for="[2001:db8::44]:443";proto=https',
			'for="_hidden";proto=https',
			'by=proxy',
			'proto=https',
			'host=example.com',
			'nonsense',
		]

		const segmentCombinations: string[][] = []
		for (const first of forwardedSegments) {
			segmentCombinations.push([first])
			for (const second of forwardedSegments) {
				segmentCombinations.push([first, second])
				for (const third of forwardedSegments) {
					segmentCombinations.push([first, second, third])
				}
			}
		}

		for (const segmentCombination of segmentCombinations) {
			const forwardedHeader = segmentCombination.join(',')
			const request = new Request('https://example.com/media', {
				headers: {
					Forwarded: forwardedHeader,
				},
			})

			let expectedIp: string | null = null
			for (const segment of segmentCombination) {
				const isolatedSegmentRequest = new Request(
					'https://example.com/media',
					{
						headers: {
							Forwarded: segment,
						},
					},
				)
				const isolatedIp = getClientIp(isolatedSegmentRequest)
				if (isolatedIp) {
					expectedIp = isolatedIp
					break
				}
			}

			expect(getClientIp(request)).toBe(expectedIp)
		}
	})

	test('preserves earliest valid candidate in deep Forwarded combination matrix', () => {
		const forwardedSegments = [
			'for=unknown;proto=https',
			'for="_hidden";proto=https',
			'for="unknown";proto=https',
			'for=198.51.100.230;proto=https',
			'for="198.51.100.231";proto=https',
			'for="unknown, 198.51.100.232";proto=https',
			'for="[2001:db8::66]:443";proto=https',
			'nonsense',
			'by=proxy',
			'proto=https',
			'host=example.com',
		]

		const segmentCombinations: string[][] = []
		for (const first of forwardedSegments) {
			segmentCombinations.push([first])
			for (const second of forwardedSegments) {
				segmentCombinations.push([first, second])
				for (const third of forwardedSegments) {
					segmentCombinations.push([first, second, third])
					for (const fourth of forwardedSegments) {
						segmentCombinations.push([first, second, third, fourth])
					}
				}
			}
		}

		for (const segmentCombination of segmentCombinations) {
			const forwardedHeader = segmentCombination.join(',')
			const request = new Request('https://example.com/media', {
				headers: {
					Forwarded: forwardedHeader,
				},
			})

			let expectedIp: string | null = null
			for (const segment of segmentCombination) {
				const isolatedSegmentRequest = new Request(
					'https://example.com/media',
					{
						headers: {
							Forwarded: segment,
						},
					},
				)
				const isolatedIp = getClientIp(isolatedSegmentRequest)
				if (isolatedIp) {
					expectedIp = isolatedIp
					break
				}
			}

			expect(getClientIp(request)).toBe(expectedIp)
		}
	})

	test('falls through nested invalid forwarded for token to later valid candidate', () => {
		const malformedThenValidRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded:
					'for="unknown, for=unknown";proto=https,for=198.51.100.246;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.246',
			},
		})

		expect(getClientIp(malformedThenValidRequest)).toBe('198.51.100.246')
		expect(getClientFingerprint(malformedThenValidRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('falls through deeply nested obfuscated forwarded for token to later valid candidate', () => {
		const malformedThenValidRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded:
					'for="unknown, for=for=for=_hidden";proto=https,for=198.51.100.251;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.251',
			},
		})

		expect(getClientIp(malformedThenValidRequest)).toBe('198.51.100.251')
		expect(getClientFingerprint(malformedThenValidRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested forwarded for tokens in quoted for chains', () => {
		const malformedNestedForRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown, for=198.51.100.248";proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.248',
			},
		})

		expect(getClientIp(malformedNestedForRequest)).toBe('198.51.100.248')
		expect(getClientFingerprint(malformedNestedForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested forwarded for tokens in escaped quoted for chains', () => {
		const malformedNestedEscapedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="\\"unknown\\", for=198.51.100.249";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.249',
			},
		})

		expect(getClientIp(malformedNestedEscapedForRequest)).toBe('198.51.100.249')
		expect(getClientFingerprint(malformedNestedEscapedForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers quoted nested forwarded for tokens in quoted chains', () => {
		const malformedNestedQuotedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, "for=198.51.100.225"";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.225',
			},
		})

		expect(getClientIp(malformedNestedQuotedForRequest)).toBe('198.51.100.225')
		expect(getClientFingerprint(malformedNestedQuotedForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested uppercase forwarded for tokens in quoted chains', () => {
		const malformedNestedUppercaseForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, FOR = 198.51.100.217";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.217',
			},
		})

		expect(getClientIp(malformedNestedUppercaseForRequest)).toBe(
			'198.51.100.217',
		)
		expect(getClientFingerprint(malformedNestedUppercaseForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested forwarded ipv6 tokens in quoted chains', () => {
		const malformedNestedIpv6ForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, for=[2001:DB8::9]:443";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::9',
			},
		})

		expect(getClientIp(malformedNestedIpv6ForRequest)).toBe('2001:db8::9')
		expect(getClientFingerprint(malformedNestedIpv6ForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested forwarded for tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedParameterizedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=198.51.100.228;proto=https";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.228',
			},
		})

		expect(getClientIp(malformedNestedParameterizedForRequest)).toBe(
			'198.51.100.228',
		)
		expect(getClientFingerprint(malformedNestedParameterizedForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers nested forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedIpv6ParameterizedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=[2001:DB8::c]:443;proto=https";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::c',
			},
		})

		expect(getClientIp(malformedNestedIpv6ParameterizedForRequest)).toBe(
			'2001:db8::c',
		)
		expect(
			getClientFingerprint(malformedNestedIpv6ParameterizedForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested forwarded for tokens in quoted chains', () => {
		const malformedNestedDoublePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, for=for=198.51.100.250";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.250',
			},
		})

		expect(getClientIp(malformedNestedDoublePrefixForRequest)).toBe(
			'198.51.100.250',
		)
		expect(getClientFingerprint(malformedNestedDoublePrefixForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers doubly-prefixed nested uppercase forwarded for tokens in quoted chains', () => {
		const malformedNestedUppercaseDoublePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, FOR=FOR=198.51.100.251";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.251',
			},
		})

		expect(getClientIp(malformedNestedUppercaseDoublePrefixForRequest)).toBe(
			'198.51.100.251',
		)
		expect(
			getClientFingerprint(malformedNestedUppercaseDoublePrefixForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested uppercase forwarded for tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedUppercaseDoublePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR=FOR=198.51.100.252;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.252',
			},
		})

		expect(
			getClientIp(malformedNestedUppercaseDoublePrefixParameterizedForRequest),
		).toBe('198.51.100.252')
		expect(
			getClientFingerprint(
				malformedNestedUppercaseDoublePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedUppercaseIpv6DoublePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR=FOR=[2001:db8::14]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::14',
			},
		})

		expect(
			getClientIp(
				malformedNestedUppercaseIpv6DoublePrefixParameterizedForRequest,
			),
		).toBe('2001:db8::14')
		expect(
			getClientFingerprint(
				malformedNestedUppercaseIpv6DoublePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested forwarded ipv6 tokens in quoted chains', () => {
		const malformedNestedIpv6DoublePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, for=for=[2001:db8::f]:443";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::f',
			},
		})

		expect(getClientIp(malformedNestedIpv6DoublePrefixForRequest)).toBe(
			'2001:db8::f',
		)
		expect(
			getClientFingerprint(malformedNestedIpv6DoublePrefixForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested forwarded for tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedDoublePrefixParameterizedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=198.51.100.248;proto=https";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.248',
			},
		})

		expect(
			getClientIp(malformedNestedDoublePrefixParameterizedForRequest),
		).toBe('198.51.100.248')
		expect(
			getClientFingerprint(malformedNestedDoublePrefixParameterizedForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedIpv6DoublePrefixParameterizedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=[2001:db8::11]:443;proto=https";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::11',
			},
		})

		expect(
			getClientIp(malformedNestedIpv6DoublePrefixParameterizedForRequest),
		).toBe('2001:db8::11')
		expect(
			getClientFingerprint(
				malformedNestedIpv6DoublePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers triply-prefixed nested forwarded for tokens in quoted chains', () => {
		const malformedNestedTriplePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, for=for=for=198.51.100.233";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.233',
			},
		})

		expect(getClientIp(malformedNestedTriplePrefixForRequest)).toBe(
			'198.51.100.233',
		)
		expect(getClientFingerprint(malformedNestedTriplePrefixForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers triply-prefixed nested forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedIpv6TriplePrefixParameterizedForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=for=[2001:db8::17]:443;proto=https";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::17',
			},
		})

		expect(
			getClientIp(malformedNestedIpv6TriplePrefixParameterizedForRequest),
		).toBe('2001:db8::17')
		expect(
			getClientFingerprint(
				malformedNestedIpv6TriplePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers triply-prefixed nested uppercase forwarded for tokens in quoted chains', () => {
		const malformedNestedUppercaseTriplePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="unknown, FOR=FOR=FOR=198.51.100.238";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.238',
			},
		})

		expect(getClientIp(malformedNestedUppercaseTriplePrefixForRequest)).toBe(
			'198.51.100.238',
		)
		expect(
			getClientFingerprint(malformedNestedUppercaseTriplePrefixForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers triply-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedUppercaseIpv6TriplePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR=FOR=FOR=[2001:db8::22]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::22',
			},
		})

		expect(
			getClientIp(
				malformedNestedUppercaseIpv6TriplePrefixParameterizedForRequest,
			),
		).toBe('2001:db8::22')
		expect(
			getClientFingerprint(
				malformedNestedUppercaseIpv6TriplePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers quadruply-prefixed nested forwarded for tokens in quoted chains', () => {
		const malformedNestedQuadruplePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=for=for=198.51.100.241";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.241',
			},
		})

		expect(getClientIp(malformedNestedQuadruplePrefixForRequest)).toBe(
			'198.51.100.241',
		)
		expect(getClientFingerprint(malformedNestedQuadruplePrefixForRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers quadruply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedIpv6QuadrupleMixedCasePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR = for = FOR = for = [2001:db8::25]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::25',
			},
		})

		expect(
			getClientIp(
				malformedNestedIpv6QuadrupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe('2001:db8::25')
		expect(
			getClientFingerprint(
				malformedNestedIpv6QuadrupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers quintuply-prefixed mixed-case nested forwarded tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedQuintupleMixedCasePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR = for = FOR = for = FOR = 198.51.100.245;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.245',
			},
		})

		expect(
			getClientIp(
				malformedNestedQuintupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe('198.51.100.245')
		expect(
			getClientFingerprint(
				malformedNestedQuintupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers quintuply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedIpv6QuintupleMixedCasePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR = for = FOR = for = FOR = [2001:db8::28]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8::28',
			},
		})

		expect(
			getClientIp(
				malformedNestedIpv6QuintupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe('2001:db8::28')
		expect(
			getClientFingerprint(
				malformedNestedIpv6QuintupleMixedCasePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed nested ipv4-mapped forwarded ipv6 tokens in quoted chains', () => {
		const malformedNestedMappedIpv6DoublePrefixForRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=[::FFFF:C633:64A0]:443";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.160',
			},
		})

		expect(getClientIp(malformedNestedMappedIpv6DoublePrefixForRequest)).toBe(
			'198.51.100.160',
		)
		expect(
			getClientFingerprint(malformedNestedMappedIpv6DoublePrefixForRequest),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers doubly-prefixed mixed-case nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedMappedIpv6MixedCaseDoublePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, FOR = FOR = [::ffff:c633:64a1]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.161',
			},
		})

		expect(
			getClientIp(
				malformedNestedMappedIpv6MixedCaseDoublePrefixParameterizedForRequest,
			),
		).toBe('198.51.100.161')
		expect(
			getClientFingerprint(
				malformedNestedMappedIpv6MixedCaseDoublePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('recovers triply-prefixed nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes in quoted chains', () => {
		const malformedNestedMappedIpv6TriplePrefixParameterizedForRequest =
			new Request('https://example.com/media', {
				headers: {
					Forwarded:
						'for="unknown, for=for=for=[::FFFF:C633:64A2]:443;proto=https";proto=https',
				},
			})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.162',
			},
		})

		expect(
			getClientIp(malformedNestedMappedIpv6TriplePrefixParameterizedForRequest),
		).toBe('198.51.100.162')
		expect(
			getClientFingerprint(
				malformedNestedMappedIpv6TriplePrefixParameterizedForRequest,
			),
		).toBe(getClientFingerprint(canonicalRequest))
	})

	test('normalizes nested dotted mapped forwarded ipv6 prefix matrix in quoted chains', () => {
		const forms = ['for=', 'for =', 'FOR=', 'FOR =']
		const wrappers = [
			(candidate: string) => `for="unknown, ${candidate}";proto=https`,
			(candidate: string) =>
				`for="unknown, ${candidate};proto=https";proto=https`,
		]
		const mappedIpv6 = '[::ffff:198.51.100.180]:443'
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.180',
			},
		})

		const buildNestedPrefixes = (
			depth: number,
			accumulatedPrefixes: string[] = [],
		): string[][] => {
			if (depth === 0) return [accumulatedPrefixes]
			const combinations: string[][] = []
			for (const form of forms) {
				combinations.push(
					...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
				)
			}
			return combinations
		}

		for (const depth of [1, 2, 3, 4, 5]) {
			for (const prefixCombination of buildNestedPrefixes(depth)) {
				const candidate = `${prefixCombination.join('')}${mappedIpv6}`
				for (const wrapCandidate of wrappers) {
					const request = new Request('https://example.com/media', {
						headers: {
							Forwarded: wrapCandidate(candidate),
						},
					})

					expect(getClientIp(request)).toBe('198.51.100.180')
					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
	})

	test('normalizes nested hexadecimal mapped forwarded ipv6 prefix matrix in quoted chains', () => {
		const forms = ['for=', 'for =', 'FOR=', 'FOR =']
		const wrappers = [
			(candidate: string) => `for="unknown, ${candidate}";proto=https`,
			(candidate: string) =>
				`for="unknown, ${candidate};proto=https";proto=https`,
		]
		const mappedIpv6 = '[::ffff:c633:64b7]:443'
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.183',
			},
		})

		const buildNestedPrefixes = (
			depth: number,
			accumulatedPrefixes: string[] = [],
		): string[][] => {
			if (depth === 0) return [accumulatedPrefixes]
			const combinations: string[][] = []
			for (const form of forms) {
				combinations.push(
					...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
				)
			}
			return combinations
		}

		for (const depth of [1, 2, 3, 4, 5]) {
			for (const prefixCombination of buildNestedPrefixes(depth)) {
				const candidate = `${prefixCombination.join('')}${mappedIpv6}`
				for (const wrapCandidate of wrappers) {
					const request = new Request('https://example.com/media', {
						headers: {
							Forwarded: wrapCandidate(candidate),
						},
					})

					expect(getClientIp(request)).toBe('198.51.100.183')
					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
	})

	test('normalizes nested mapped forwarded values when for appears after other parameters', () => {
		const cases = [
			{
				forwarded:
					'proto=https;by=198.51.100.1;for="unknown, for=for=[::ffff:198.51.100.193]:443";host=example.com',
				canonicalIp: '198.51.100.193',
			},
			{
				forwarded:
					'proto=https;by=198.51.100.1;for="unknown, FOR = for = [::ffff:c633:64c2]:443;proto=https";host=example.com',
				canonicalIp: '198.51.100.194',
			},
			{
				forwarded:
					'by=198.51.100.1;host=example.com;for="unknown, FOR = FOR = [::FFFF:C633:64C3]:443";proto=https',
				canonicalIp: '198.51.100.195',
			},
		]

		for (const testCase of cases) {
			const request = new Request('https://example.com/media', {
				headers: {
					Forwarded: testCase.forwarded,
				},
			})
			const canonicalRequest = new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
				},
			})

			expect(getClientIp(request)).toBe(testCase.canonicalIp)
			expect(getClientFingerprint(request)).toBe(
				getClientFingerprint(canonicalRequest),
			)
		}
	})

	test('handles repeated Forwarded for parameters within a segment', () => {
		const cases = [
			{
				forwarded: 'for=unknown;for=198.51.100.166;proto=https',
				canonicalIp: '198.51.100.166',
			},
			{
				forwarded: 'for=198.51.100.167;for=198.51.100.168;proto=https',
				canonicalIp: '198.51.100.167',
			},
			{
				forwarded:
					'proto=https;for=_hidden;for="[::ffff:198.51.100.169]:443";by=proxy',
				canonicalIp: '198.51.100.169',
			},
			{
				forwarded: 'for = unknown; for = 198.51.100.173; proto=https',
				canonicalIp: '198.51.100.173',
			},
			{
				forwarded: 'FOR=198.51.100.174; FOR=198.51.100.175; proto=https',
				canonicalIp: '198.51.100.174',
			},
		]

		for (const testCase of cases) {
			const request = new Request('https://example.com/media', {
				headers: {
					Forwarded: testCase.forwarded,
				},
			})
			const canonicalRequest = new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
				},
			})

			expect(getClientIp(request)).toBe(testCase.canonicalIp)
			expect(getClientFingerprint(request)).toBe(
				getClientFingerprint(canonicalRequest),
			)
		}
	})

	test('preserves repeated Forwarded for parameter precedence matrix', () => {
		for (const buildHeader of repeatedForwardedForHeaderBuilders) {
			for (const firstValue of repeatedForwardedForValues) {
				for (const secondValue of repeatedForwardedForValues) {
					const repeatedHeader = buildHeader(firstValue, secondValue)
					const request = new Request('https://example.com/media', {
						headers: {
							Forwarded: repeatedHeader,
						},
					})
					const firstOnlyRequest = new Request('https://example.com/media', {
						headers: {
							Forwarded: `for=${firstValue};proto=https`,
						},
					})
					const secondOnlyRequest = new Request('https://example.com/media', {
						headers: {
							Forwarded: `for=${secondValue};proto=https`,
						},
					})

					const expectedIp =
						getClientIp(firstOnlyRequest) ??
						getClientIp(secondOnlyRequest) ??
						null

					expect(getClientIp(request)).toBe(expectedIp)

					if (expectedIp === null) {
						expect(getClientFingerprint(request)).toBeNull()
						continue
					}

					const canonicalRequest = new Request('https://example.com/media', {
						headers: {
							'X-Forwarded-For': expectedIp,
						},
					})

					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
	})

	test('normalizes reordered Forwarded nested prefix matrix for mapped values', () => {
		const forms = ['for=', 'for =', 'FOR=', 'FOR =']
		const wrappers = [
			(candidate: string) =>
				`proto=https;by=198.51.100.1;for="unknown, ${candidate}";host=example.com`,
			(candidate: string) =>
				`host=example.com;proto=https;for="unknown, ${candidate};proto=https";by=198.51.100.1`,
		]
		const mappedIpv6 = '[::ffff:198.51.100.196]:443'
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.196',
			},
		})

		const buildNestedPrefixes = (
			depth: number,
			accumulatedPrefixes: string[] = [],
		): string[][] => {
			if (depth === 0) return [accumulatedPrefixes]
			const combinations: string[][] = []
			for (const form of forms) {
				combinations.push(
					...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
				)
			}
			return combinations
		}

		for (const depth of [1, 2, 3, 4]) {
			for (const prefixCombination of buildNestedPrefixes(depth)) {
				const candidate = `${prefixCombination.join('')}${mappedIpv6}`
				for (const wrapCandidate of wrappers) {
					const request = new Request('https://example.com/media', {
						headers: {
							Forwarded: wrapCandidate(candidate),
						},
					})

					expect(getClientIp(request)).toBe('198.51.100.196')
					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
	})

	test('normalizes reordered escaped-quote Forwarded nested prefix matrix for mapped values', () => {
		const forms = ['for=', 'for =', 'FOR=', 'FOR =']
		const wrappers = [
			(candidate: string) =>
				`proto=https;by=198.51.100.1;for="\\"unknown\\", ${candidate}";host=example.com`,
			(candidate: string) =>
				`by=198.51.100.1;host=example.com;for="\\"unknown\\", ${candidate};proto=https";proto=https`,
		]
		const mappedIpv6 = '[::ffff:198.51.100.197]:443'
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.197',
			},
		})

		const buildNestedPrefixes = (
			depth: number,
			accumulatedPrefixes: string[] = [],
		): string[][] => {
			if (depth === 0) return [accumulatedPrefixes]
			const combinations: string[][] = []
			for (const form of forms) {
				combinations.push(
					...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
				)
			}
			return combinations
		}

		for (const depth of [1, 2, 3, 4]) {
			for (const prefixCombination of buildNestedPrefixes(depth)) {
				const candidate = `${prefixCombination.join('')}${mappedIpv6}`
				for (const wrapCandidate of wrappers) {
					const request = new Request('https://example.com/media', {
						headers: {
							Forwarded: wrapCandidate(candidate),
						},
					})

					expect(getClientIp(request)).toBe('198.51.100.197')
					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
	})

	test('falls through reordered nested invalid Forwarded chains to later valid candidates', () => {
		const cases = [
			{
				forwarded:
					'proto=https;by=198.51.100.1;for="unknown, for=for=_hidden";host=example.com,for=198.51.100.198;proto=https',
				canonicalIp: '198.51.100.198',
			},
			{
				forwarded:
					'proto=https;by=198.51.100.1;for="\\"unknown\\", FOR = for = _hidden;proto=https";host=example.com,for=198.51.100.199;proto=https',
				canonicalIp: '198.51.100.199',
			},
			{
				forwarded:
					'host=example.com;proto=https;for="unknown, for=for=unknown";by=198.51.100.1,for=198.51.100.200;proto=https',
				canonicalIp: '198.51.100.200',
			},
		]

		for (const testCase of cases) {
			const request = new Request('https://example.com/media', {
				headers: {
					Forwarded: testCase.forwarded,
				},
			})
			const canonicalRequest = new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
				},
			})

			expect(getClientIp(request)).toBe(testCase.canonicalIp)
			expect(getClientFingerprint(request)).toBe(
				getClientFingerprint(canonicalRequest),
			)
		}
	})

	test('falls through deeply nested invalid forwarded for token to later valid candidate', () => {
		const malformedNestedInvalidThenValidRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded:
						'for="unknown, for=for=for=unknown";proto=https,for=198.51.100.246;proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.246',
			},
		})

		expect(getClientIp(malformedNestedInvalidThenValidRequest)).toBe(
			'198.51.100.246',
		)
		expect(getClientFingerprint(malformedNestedInvalidThenValidRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers malformed Forwarded chains with proto on trailing segment', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown, 198.51.100.249;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.249')
	})

	test('recovers malformed escaped-quote Forwarded chains with proto segments', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="\\"unknown\\", 198.51.100.242;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.242')
	})

	test('recovers dangling trailing quotes in Forwarded for values', () => {
		const danglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for=198.51.100.250";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.250',
			},
		})

		expect(getClientIp(danglingTrailingQuoteRequest)).toBe('198.51.100.250')
		expect(getClientFingerprint(danglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling trailing quotes in Forwarded for values', () => {
		const repeatedDanglingTrailingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for=198.51.100.253"";proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.253',
			},
		})

		expect(getClientIp(repeatedDanglingTrailingQuoteRequest)).toBe(
			'198.51.100.253',
		)
		expect(getClientFingerprint(repeatedDanglingTrailingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers dangling leading quotes in Forwarded for values', () => {
		const danglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for="198.51.100.252;proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.252',
			},
		})

		expect(getClientIp(danglingLeadingQuoteRequest)).toBe('198.51.100.252')
		expect(getClientFingerprint(danglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('recovers repeated dangling leading quotes in Forwarded for values', () => {
		const repeatedDanglingLeadingQuoteRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					Forwarded: 'for=""198.51.100.254;proto=https',
				},
			},
		)
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.254',
			},
		})

		expect(getClientIp(repeatedDanglingLeadingQuoteRequest)).toBe(
			'198.51.100.254',
		)
		expect(getClientFingerprint(repeatedDanglingLeadingQuoteRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('uses stable fingerprints for malformed escaped-quote X-Forwarded-For chains', () => {
		const malformedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.234',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.234',
			},
		})

		expect(getClientFingerprint(malformedRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('uses stable fingerprints for malformed escaped-quote X-Real-IP chains', () => {
		const malformedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '"\\"unknown\\", 198.51.100.225:8443',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Real-IP': '198.51.100.225',
			},
		})

		expect(getClientFingerprint(malformedRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
	})

	test('uses stable fingerprints for malformed Forwarded proto-tail chains', () => {
		const malformedRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="unknown, 198.51.100.249;proto=https',
			},
		})
		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '198.51.100.249',
			},
		})

		expect(getClientFingerprint(malformedRequest)).toBe(
			getClientFingerprint(canonicalRequest),
		)
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

	test('uses Forwarded header when X-Forwarded-For values are non-IP tokens', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': 'proxy.internal, app.server',
				Forwarded: 'for=203.0.113.62;proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.62')
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

	test('falls back to X-Real-IP when Forwarded values are not IPs', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=app-server.internal, for=proxy.local',
				'X-Real-IP': '198.51.100.124',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.124')
	})

	test('prefers Forwarded over X-Real-IP when X-Forwarded-For is missing', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for=203.0.113.66;proto=https',
				'X-Real-IP': '198.51.100.126',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.66')
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

	test('normalizes X-Forwarded-For bracketed IPv6 values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '[2001:db8:cafe::31]:8443',
			},
		})

		expect(getClientIp(request)).toBe('2001:db8:cafe::31')
	})

	test('normalizes quoted X-Forwarded-For values with ports', () => {
		const quotedIpv4WithPortRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"198.51.100.49:8443"',
			},
		})
		const quotedBracketedIpv6WithPortRequest = new Request(
			'https://example.com/media',
			{
				headers: {
					'X-Forwarded-For': '"[2001:DB8:CAFE::64]:443"',
				},
			},
		)
		const invalidQuotedPortRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '"198.51.100.49:abc"',
			},
		})

		expect(getClientIp(quotedIpv4WithPortRequest)).toBe('198.51.100.49')
		expect(getClientIp(quotedBracketedIpv6WithPortRequest)).toBe(
			'2001:db8:cafe::64',
		)
		expect(getClientIp(invalidQuotedPortRequest)).toBeNull()
	})

	test('normalizes uppercase IPv6 values to lowercase', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:DB8:CAFE::3A',
			},
		})

		expect(getClientIp(request)).toBe('2001:db8:cafe::3a')
	})

	test('normalizes expanded IPv6 values to canonical compressed form', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:0db8:cafe:0000:0000:0000:0000:0065',
			},
		})

		expect(getClientIp(request)).toBe('2001:db8:cafe::65')
	})

	test('skips malformed bracketed X-Forwarded-For IPv6 values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '[2001:db8:cafe::31, 198.51.100.84',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.84')
	})

	test('skips bracketed X-Forwarded-For IPv6 values with invalid suffixes', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '[2001:db8:cafe::31]oops, 198.51.100.85',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.85')
	})

	test('normalizes quoted forwarded IPv6 values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[2001:db8:cafe::17]:4711";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('2001:db8:cafe::17')
	})

	test('normalizes uppercase and lowercase IPv6 values to stable fingerprints', () => {
		const uppercaseRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:DB8:CAFE::3B',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const lowercaseRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8:cafe::3b',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(uppercaseRequest)).toBe(
			getClientFingerprint(lowercaseRequest),
		)
	})

	test('normalizes expanded and compressed IPv6 values to stable fingerprints', () => {
		const expandedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:0db8:cafe:0000:0000:0000:0000:0066',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const compressedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '2001:db8:cafe::66',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(expandedRequest)).toBe(
			getClientFingerprint(compressedRequest),
		)
	})

	test('normalizes IPv4-mapped IPv6 Forwarded values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[::ffff:203.0.113.90]:443";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.90')
	})

	test('normalizes hexadecimal IPv4-mapped IPv6 values', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '::ffff:cb00:710a',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.10')
	})

	test('normalizes hexadecimal IPv4-mapped Forwarded values with ports', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[::ffff:cb00:710e]:443";proto=https',
			},
		})

		expect(getClientIp(request)).toBe('203.0.113.14')
	})

	test('normalizes IPv4-mapped IPv6 values for stable fingerprints', () => {
		const mappedRequest = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'for="[::ffff:203.0.113.91]:443";proto=https',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const plainIpv4Request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.91',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(mappedRequest)).toBe(
			getClientFingerprint(plainIpv4Request),
		)
	})

	test('normalizes hex and dotted IPv4-mapped IPv6 values to stable fingerprints', () => {
		const hexMappedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '::ffff:cb00:710b',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const dottedMappedRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '::ffff:203.0.113.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})
		const plainIpv4Request = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': '203.0.113.11',
				'User-Agent': 'Pocket Casts/7.0',
			},
		})

		expect(getClientFingerprint(hexMappedRequest)).toBe(
			getClientFingerprint(dottedMappedRequest),
		)
		expect(getClientFingerprint(hexMappedRequest)).toBe(
			getClientFingerprint(plainIpv4Request),
		)
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

	test('parses Forwarded for keys when parameter order varies', () => {
		const request = new Request('https://example.com/media', {
			headers: {
				Forwarded: 'proto=https;by=198.51.100.1;for=198.51.100.86',
			},
		})

		expect(getClientIp(request)).toBe('198.51.100.86')
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

	test('applies X-Forwarded-For, Forwarded, then X-Real-IP precedence matrix', () => {
		const cases = [
			{
				headers: {
					'X-Forwarded-For': 'unknown, 203.0.113.121',
					Forwarded: 'for=198.51.100.131;proto=https',
					'X-Real-IP': '198.51.100.141',
				},
				canonicalIp: '203.0.113.121',
			},
			{
				headers: {
					'X-Forwarded-For': 'unknown, nonsense',
					Forwarded: 'for=198.51.100.132;proto=https',
					'X-Real-IP': '198.51.100.142',
				},
				canonicalIp: '198.51.100.132',
			},
			{
				headers: {
					'X-Forwarded-For': 'unknown, nonsense',
					Forwarded: 'for=unknown;proto=https',
					'X-Real-IP': '"198.51.100.143:8443"',
				},
				canonicalIp: '198.51.100.143',
			},
		]

		for (const testCase of cases) {
			const request = new Request('https://example.com/media', {
				headers: testCase.headers,
			})
			const canonicalRequest = new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
				},
			})

			expect(getClientIp(request)).toBe(testCase.canonicalIp)
			expect(getClientFingerprint(request)).toBe(
				getClientFingerprint(canonicalRequest),
			)
		}
	})

	test('preserves cross-header precedence across segment combination matrix', () => {
		const xForwardedForValues = crossHeaderXForwardedForValues
		const forwardedValues = crossHeaderForwardedValues
		const xRealIpValues = crossHeaderXRealIpValues
		const userAgent = 'Pocket Casts/7.0'

		const xForwardedForResults = new Map<string | null, string | null>()
		const forwardedResults = new Map<string | null, string | null>()
		const xRealIpResults = new Map<string | null, string | null>()

		for (const headerValue of xForwardedForValues) {
			if (headerValue === null) {
				xForwardedForResults.set(headerValue, null)
				continue
			}
			xForwardedForResults.set(
				headerValue,
				getClientIp(
					new Request('https://example.com/media', {
						headers: {
							'X-Forwarded-For': headerValue,
						},
					}),
				),
			)
		}
		for (const headerValue of forwardedValues) {
			if (headerValue === null) {
				forwardedResults.set(headerValue, null)
				continue
			}
			forwardedResults.set(
				headerValue,
				getClientIp(
					new Request('https://example.com/media', {
						headers: {
							Forwarded: headerValue,
						},
					}),
				),
			)
		}
		for (const headerValue of xRealIpValues) {
			if (headerValue === null) {
				xRealIpResults.set(headerValue, null)
				continue
			}
			xRealIpResults.set(
				headerValue,
				getClientIp(
					new Request('https://example.com/media', {
						headers: {
							'X-Real-IP': headerValue,
						},
					}),
				),
			)
		}

		for (const xForwardedForValue of xForwardedForValues) {
			for (const forwardedValue of forwardedValues) {
				for (const xRealIpValue of xRealIpValues) {
					const headers: Record<string, string> = {}
					if (xForwardedForValue !== null) {
						headers['X-Forwarded-For'] = xForwardedForValue
					}
					if (forwardedValue !== null) {
						headers.Forwarded = forwardedValue
					}
					if (xRealIpValue !== null) {
						headers['X-Real-IP'] = xRealIpValue
					}

					const request = new Request('https://example.com/media', {
						headers: {
							...headers,
							'User-Agent': userAgent,
						},
					})
					const expectedIp =
						xForwardedForResults.get(xForwardedForValue) ??
						forwardedResults.get(forwardedValue) ??
						xRealIpResults.get(xRealIpValue) ??
						null

					expect(getClientIp(request)).toBe(expectedIp)
					const canonicalRequestHeaders: Record<string, string> = {
						'User-Agent': userAgent,
					}
					if (expectedIp !== null) {
						canonicalRequestHeaders['X-Forwarded-For'] = expectedIp
					}
					const canonicalRequest = new Request('https://example.com/media', {
						headers: canonicalRequestHeaders,
					})
					expect(getClientFingerprint(request)).toBe(
						getClientFingerprint(canonicalRequest),
					)
				}
			}
		}
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
