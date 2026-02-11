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
