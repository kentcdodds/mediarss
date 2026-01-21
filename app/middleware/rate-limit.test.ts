import { expect, test } from 'bun:test'
import { invariant } from '@epic-web/invariant'
import type { RequestContext } from 'remix/fetch-router'
import { consoleWarn } from '#test/setup.ts'

// Configure rate limits for testing BEFORE importing any source code
// Note: With failure penalty (10x cost for failed requests), these limits must
// be high enough for other tests that make failed requests intentionally
const TEST_RATE_LIMITS = {
	RATE_LIMIT_ADMIN_READ: '100',
	RATE_LIMIT_ADMIN_WRITE: '50',
	RATE_LIMIT_MEDIA: '100',
	RATE_LIMIT_DEFAULT: '100',
}

// Set environment variables BEFORE importing source code
for (const [key, value] of Object.entries(TEST_RATE_LIMITS)) {
	Bun.env[key] = value
}

// Dynamic imports ensure env vars are set before modules are loaded
const { initEnv } = await import('#app/config/env.ts')
const { resetRateLimiters } = await import('#app/helpers/rate-limiter.ts')
const { rateLimit } = await import('./rate-limit.ts')

// Initialize environment for tests (will use our lower rate limits)
initEnv()

// Reset any previously created rate limiters so they pick up the test config
resetRateLimiters()

/**
 * Helper to call the rate limit middleware with a request.
 */
async function callRateLimiter(
	pathname: string,
	options: {
		method?: string
		ip?: string
		headers?: Record<string, string>
	} = {},
) {
	const { method = 'GET', ip, headers = {} } = options
	if (ip) headers['X-Forwarded-For'] = ip

	const request = new Request(`http://localhost${pathname}`, {
		method,
		headers,
	})
	const context = {
		request,
		url: new URL(request.url),
		method: request.method,
		params: {},
	} as RequestContext

	const middleware = rateLimit()
	const next = () => Promise.resolve(new Response('OK', { status: 200 }))
	return middleware(context, next)
}

test('rate limiter skips rate limiting for health check and static assets', async () => {
	// Health check endpoint should not have rate limit headers
	const healthResponse = await callRateLimiter('/admin/health')
	invariant(healthResponse, 'Expected response')
	expect(healthResponse.headers.has('X-RateLimit-Limit')).toBe(false)
	expect(healthResponse.status).toBe(200)

	// Static assets should not have rate limit headers
	const assetsResponse = await callRateLimiter('/assets/styles.css')
	invariant(assetsResponse, 'Expected response')
	expect(assetsResponse.headers.has('X-RateLimit-Limit')).toBe(false)
	expect(assetsResponse.status).toBe(200)
})

test('rate limiter extracts IP from various headers correctly', async () => {
	// X-Forwarded-For header (uses first IP in chain)
	const xffResponse = await callRateLimiter('/admin', {
		ip: '192.168.1.100, 10.0.0.1',
	})
	invariant(xffResponse, 'Expected response')
	expect(xffResponse.status).toBe(200)
	expect(xffResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)

	// X-Real-IP header
	const realIpRequest = new Request('http://localhost/admin', {
		headers: { 'X-Real-IP': '192.168.1.100' },
	})
	const context = {
		request: realIpRequest,
		url: new URL(realIpRequest.url),
		method: realIpRequest.method,
		params: {},
	} as RequestContext
	const middleware = rateLimit()
	const next = () => Promise.resolve(new Response('OK', { status: 200 }))
	const realIpResponse = await middleware(context, next)
	invariant(realIpResponse, 'Expected response')
	expect(realIpResponse.status).toBe(200)

	// Fallback to 127.0.0.1 when no IP headers present
	const noIpResponse = await callRateLimiter('/admin')
	invariant(noIpResponse, 'Expected response')
	expect(noIpResponse.status).toBe(200)
})

test('rate limiter uses correct limits for different route types and HTTP methods', async () => {
	// Admin read routes (GET, HEAD, OPTIONS)
	const adminGetResponse = await callRateLimiter('/admin/api/feeds')
	invariant(adminGetResponse, 'Expected response')
	expect(adminGetResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)

	const adminHeadResponse = await callRateLimiter('/admin', { method: 'HEAD' })
	invariant(adminHeadResponse, 'Expected response')
	expect(adminHeadResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)

	const adminOptionsResponse = await callRateLimiter('/admin', {
		method: 'OPTIONS',
	})
	invariant(adminOptionsResponse, 'Expected response')
	expect(adminOptionsResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)

	// Admin write routes (POST, PUT, DELETE)
	const adminPostResponse = await callRateLimiter('/admin/api/feeds', {
		method: 'POST',
	})
	invariant(adminPostResponse, 'Expected response')
	expect(adminPostResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)

	const adminPutResponse = await callRateLimiter('/admin/api/feeds/1', {
		method: 'PUT',
	})
	invariant(adminPutResponse, 'Expected response')
	expect(adminPutResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)

	const adminDeleteResponse = await callRateLimiter('/admin/api/feeds/1', {
		method: 'DELETE',
	})
	invariant(adminDeleteResponse, 'Expected response')
	expect(adminDeleteResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)

	// Media routes
	const mediaResponse = await callRateLimiter(
		'/media/token123/path/to/file.mp3',
	)
	invariant(mediaResponse, 'Expected response')
	expect(mediaResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_MEDIA,
	)

	// Default routes (feed, art)
	const feedResponse = await callRateLimiter('/feed/token123')
	invariant(feedResponse, 'Expected response')
	expect(feedResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_DEFAULT,
	)

	const artResponse = await callRateLimiter('/art/token123/path')
	invariant(artResponse, 'Expected response')
	expect(artResponse.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_DEFAULT,
	)
})

test('rate limiter adds X-RateLimit headers and enforces limits', async () => {
	// Verify rate limit headers are added
	const response = await callRateLimiter('/feed/token', { ip: '10.0.0.1' })
	invariant(response, 'Expected response')
	expect(response.headers.has('X-RateLimit-Limit')).toBe(true)
	expect(response.headers.has('X-RateLimit-Remaining')).toBe(true)
})

test('rate limiter returns 429 with Retry-After when limit is exceeded', async () => {
	// Rate limit blocking logs a warning, which is expected
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `rate-limit-test-${Date.now()}`
	const adminWriteLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE, 10)

	// Make requests up to the limit
	for (let i = 0; i < adminWriteLimit; i++) {
		await callRateLimiter('/admin/api/feeds', { method: 'POST', ip: uniqueIp })
	}

	// Next request should be blocked
	const blockedResponse = await callRateLimiter('/admin/api/feeds', {
		method: 'POST',
		ip: uniqueIp,
	})
	invariant(blockedResponse, 'Expected response')

	expect(blockedResponse.status).toBe(429)
	expect(blockedResponse.headers.has('Retry-After')).toBe(true)
	expect(blockedResponse.headers.get('X-RateLimit-Remaining')).toBe('0')
	expect(consoleWarn).toHaveBeenCalled()
})

test('rate limiter tracks different route types independently', async () => {
	// Rate limit blocking logs a warning, which is expected
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `separate-limits-test-${Date.now()}`
	const adminWriteLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE, 10)

	// Exhaust admin-write limit
	for (let i = 0; i < adminWriteLimit; i++) {
		await callRateLimiter('/admin/api/feeds', { method: 'POST', ip: uniqueIp })
	}

	// Admin POST should now be blocked
	const adminPostResponse = await callRateLimiter('/admin/api/feeds', {
		method: 'POST',
		ip: uniqueIp,
	})
	invariant(adminPostResponse, 'Expected response')
	expect(adminPostResponse.status).toBe(429)
	expect(consoleWarn).toHaveBeenCalled()

	// But admin GET should still work (different limiter)
	const adminGetResponse = await callRateLimiter('/admin/api/feeds', {
		ip: uniqueIp,
	})
	invariant(adminGetResponse, 'Expected response')
	expect(adminGetResponse.status).toBe(200)

	// And media routes should still work (different limiter)
	const mediaResponse = await callRateLimiter('/media/token/file.mp3', {
		ip: uniqueIp,
	})
	invariant(mediaResponse, 'Expected response')
	expect(mediaResponse.status).toBe(200)
})

/**
 * Helper to call the rate limit middleware with a custom response status.
 */
async function callRateLimiterWithResponseStatus(
	pathname: string,
	responseStatus: number,
	options: {
		method?: string
		ip?: string
		headers?: Record<string, string>
	} = {},
) {
	const { method = 'GET', ip, headers = {} } = options
	if (ip) headers['X-Forwarded-For'] = ip

	const request = new Request(`http://localhost${pathname}`, {
		method,
		headers,
	})
	const context = {
		request,
		url: new URL(request.url),
		method: request.method,
		params: {},
	} as RequestContext

	const middleware = rateLimit()
	const next = () =>
		Promise.resolve(new Response('Response', { status: responseStatus }))
	return middleware(context, next)
}

test('rate limiter applies 10x penalty for 401 Unauthorized responses', async () => {
	// Rate limit blocking logs a warning, which is expected
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `failure-401-test-${Date.now()}`
	const adminReadLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ, 10)

	// Make requests until we're 10 away from the limit
	// Then a single 401 should consume 10 slots (1 + 9 penalty) and block us
	for (let i = 0; i < adminReadLimit - 10; i++) {
		await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	}

	// One failed 401 request should consume 10 slots (1 initial + 9 penalty)
	const failedResponse = await callRateLimiterWithResponseStatus(
		'/admin/api/feeds',
		401,
		{ ip: uniqueIp },
	)
	invariant(failedResponse, 'Expected response')
	expect(failedResponse.status).toBe(401)

	// Should now be blocked (used 90 + 10 = 100, at limit)
	const blockedResponse = await callRateLimiter('/admin/api/feeds', {
		ip: uniqueIp,
	})
	invariant(blockedResponse, 'Expected response')
	expect(blockedResponse.status).toBe(429)
})

test('rate limiter applies 10x penalty for 403 Forbidden responses', async () => {
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `failure-403-test-${Date.now()}`
	const adminReadLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ, 10)

	// Make requests until we're 10 away from the limit
	for (let i = 0; i < adminReadLimit - 10; i++) {
		await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	}

	// One failed 403 request should consume 10 slots
	const failedResponse = await callRateLimiterWithResponseStatus(
		'/admin/api/feeds',
		403,
		{ ip: uniqueIp },
	)
	invariant(failedResponse, 'Expected response')
	expect(failedResponse.status).toBe(403)

	// Should now be blocked
	const blockedResponse = await callRateLimiter('/admin/api/feeds', {
		ip: uniqueIp,
	})
	invariant(blockedResponse, 'Expected response')
	expect(blockedResponse.status).toBe(429)
})

test('rate limiter applies 10x penalty for 400 Bad Request responses', async () => {
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `failure-400-test-${Date.now()}`
	const adminReadLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ, 10)

	// Make requests until we're 10 away from the limit
	for (let i = 0; i < adminReadLimit - 10; i++) {
		await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	}

	// One failed 400 request should consume 10 slots
	const failedResponse = await callRateLimiterWithResponseStatus(
		'/admin/api/feeds',
		400,
		{ ip: uniqueIp },
	)
	invariant(failedResponse, 'Expected response')
	expect(failedResponse.status).toBe(400)

	// Should now be blocked
	const blockedResponse = await callRateLimiter('/admin/api/feeds', {
		ip: uniqueIp,
	})
	invariant(blockedResponse, 'Expected response')
	expect(blockedResponse.status).toBe(429)
})

test('rate limiter does NOT apply penalty for 404 Not Found responses', async () => {
	const uniqueIp = `no-penalty-404-test-${Date.now()}`

	// Multiple 404 responses should not trigger penalty
	// (404s are typically legitimate navigation/crawling, not abuse)
	for (let i = 0; i < 5; i++) {
		const response = await callRateLimiterWithResponseStatus(
			'/admin/api/feeds',
			404,
			{ ip: uniqueIp },
		)
		invariant(response, 'Expected response')
		expect(response.status).toBe(404)
	}

	// Should still have quota remaining (only 5 of 100 slots used, no penalty applied)
	const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})

test('rate limiter does NOT apply penalty for 405 Method Not Allowed responses', async () => {
	const uniqueIp = `no-penalty-405-test-${Date.now()}`

	// Multiple 405 responses should not trigger penalty
	for (let i = 0; i < 5; i++) {
		const response = await callRateLimiterWithResponseStatus(
			'/admin/api/feeds',
			405,
			{ ip: uniqueIp },
		)
		invariant(response, 'Expected response')
		expect(response.status).toBe(405)
	}

	// Should still have quota remaining
	const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})

test('rate limiter does NOT apply penalty for 429 Too Many Requests responses', async () => {
	const uniqueIp = `no-penalty-429-test-${Date.now()}`

	// 429 responses should not trigger penalty (avoid double-penalizing)
	// This could happen if an upstream service returns 429
	for (let i = 0; i < 5; i++) {
		const response = await callRateLimiterWithResponseStatus(
			'/admin/api/feeds',
			429,
			{ ip: uniqueIp },
		)
		invariant(response, 'Expected response')
		expect(response.status).toBe(429)
	}

	// Should still have quota remaining (only 5 of 100 slots used, no penalty applied)
	const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})

test('rate limiter does NOT apply penalty for 500 Server Error responses', async () => {
	const uniqueIp = `no-penalty-500-test-${Date.now()}`

	// Server errors should not penalize the client
	for (let i = 0; i < 5; i++) {
		const response = await callRateLimiterWithResponseStatus(
			'/admin/api/feeds',
			500,
			{ ip: uniqueIp },
		)
		invariant(response, 'Expected response')
		expect(response.status).toBe(500)
	}

	// Should still have quota remaining
	const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})

test('rate limiter does NOT apply penalty for 200 OK responses', async () => {
	const uniqueIp = `no-penalty-200-test-${Date.now()}`

	// Successful responses should not trigger any penalty
	for (let i = 0; i < 9; i++) {
		const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
		invariant(response, 'Expected response')
		expect(response.status).toBe(200)
	}

	// 10th request should still work (at limit, not over)
	const response = await callRateLimiter('/admin/api/feeds', { ip: uniqueIp })
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})
