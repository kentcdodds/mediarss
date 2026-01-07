import { expect, test } from 'bun:test'
import { invariant } from '@epic-web/invariant'
import type { RequestContext } from '@remix-run/fetch-router'
import { consoleWarn } from '#test/setup.ts'

// Configure lower rate limits for faster tests BEFORE importing any source code
// These values are much lower than production defaults to reduce test iterations
const TEST_RATE_LIMITS = {
	RATE_LIMIT_ADMIN_READ: '10',
	RATE_LIMIT_ADMIN_WRITE: '5',
	RATE_LIMIT_MEDIA: '10',
	RATE_LIMIT_DEFAULT: '10',
}

// Set environment variables BEFORE importing source code
// Use Bun.env instead of process.env for consistency with Bun runtime
for (const [key, value] of Object.entries(TEST_RATE_LIMITS)) {
	Bun.env[key] = value
}

// Dynamic imports ensure env vars are set before modules are loaded
const { initEnv } = await import('#app/config/env.ts')
const { rateLimit } = await import('./rate-limit.ts')

// Initialize environment for tests (will use our lower rate limits)
initEnv()

/**
 * Helper to call the rate limit middleware with a request.
 * Returns the response (may be undefined for skipped paths).
 */
async function callRateLimiter(
	pathname: string,
	options: { method?: string; ip?: string } = {},
) {
	const { method = 'GET', ip } = options
	const headers: Record<string, string> = {}
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

// Skip path tests

test('rate limiter skips /admin/health (health check endpoint)', async () => {
	const response = await callRateLimiter('/admin/health')
	invariant(response, 'Expected response')

	// Should not have rate limit headers (skipped)
	expect(response.headers.has('X-RateLimit-Limit')).toBe(false)
	expect(response.status).toBe(200)
})

test('rate limiter skips /assets/* (static files)', async () => {
	const response = await callRateLimiter('/assets/styles.css')
	invariant(response, 'Expected response')

	// Should not have rate limit headers (skipped)
	expect(response.headers.has('X-RateLimit-Limit')).toBe(false)
	expect(response.status).toBe(200)
})

// IP extraction tests

test('rate limiter extracts IP from X-Forwarded-For header (uses first IP)', async () => {
	const response = await callRateLimiter('/admin', {
		ip: '192.168.1.100, 10.0.0.1',
	})
	invariant(response, 'Expected response')

	expect(response.status).toBe(200)
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)
})

test('rate limiter extracts IP from X-Real-IP header', async () => {
	const request = new Request('http://localhost/admin', {
		headers: { 'X-Real-IP': '192.168.1.100' },
	})
	const context = {
		request,
		url: new URL(request.url),
		method: request.method,
		params: {},
	} as RequestContext

	const middleware = rateLimit()
	const next = () => Promise.resolve(new Response('OK', { status: 200 }))
	const response = await middleware(context, next)
	invariant(response, 'Expected response')

	expect(response.status).toBe(200)
})

test('rate limiter falls back to 127.0.0.1 when no IP headers present', async () => {
	const response = await callRateLimiter('/admin')
	invariant(response, 'Expected response')
	expect(response.status).toBe(200)
})

// Route-based limiter selection tests

test('rate limiter uses admin-read limit for GET /admin/*', async () => {
	const response = await callRateLimiter('/admin/api/feeds')
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)
})

test('rate limiter uses admin-read limit for HEAD /admin/*', async () => {
	const response = await callRateLimiter('/admin', { method: 'HEAD' })
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)
})

test('rate limiter uses admin-read limit for OPTIONS /admin/*', async () => {
	const response = await callRateLimiter('/admin', { method: 'OPTIONS' })
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_READ,
	)
})

test('rate limiter uses admin-write limit for POST /admin/*', async () => {
	const response = await callRateLimiter('/admin/api/feeds', { method: 'POST' })
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)
})

test('rate limiter uses admin-write limit for PUT /admin/*', async () => {
	const response = await callRateLimiter('/admin/api/feeds/1', {
		method: 'PUT',
	})
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)
})

test('rate limiter uses admin-write limit for DELETE /admin/*', async () => {
	const response = await callRateLimiter('/admin/api/feeds/1', {
		method: 'DELETE',
	})
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE,
	)
})

test('rate limiter uses media limit for /media/* routes', async () => {
	const response = await callRateLimiter('/media/token123/path/to/file.mp3')
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_MEDIA,
	)
})

test('rate limiter uses default limit for /feed/* routes', async () => {
	const response = await callRateLimiter('/feed/token123')
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_DEFAULT,
	)
})

test('rate limiter uses default limit for /art/* routes', async () => {
	const response = await callRateLimiter('/art/token123/path')
	invariant(response, 'Expected response')
	expect(response.headers.get('X-RateLimit-Limit')).toBe(
		TEST_RATE_LIMITS.RATE_LIMIT_DEFAULT,
	)
})

// Rate limiting behavior tests

test('rate limiter adds X-RateLimit-* headers to successful responses', async () => {
	const response = await callRateLimiter('/feed/token', { ip: '10.0.0.1' })
	invariant(response, 'Expected response')

	expect(response.headers.has('X-RateLimit-Limit')).toBe(true)
	expect(response.headers.has('X-RateLimit-Remaining')).toBe(true)
})

test('rate limiter returns 429 with Retry-After when limit exceeded', async () => {
	// Rate limit blocking logs a warning, which is expected
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `rate-limit-test-${Date.now()}`
	const adminWriteLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE, 10)

	// Make requests up to the limit
	for (let i = 0; i < adminWriteLimit; i++) {
		await callRateLimiter('/admin/api/feeds', { method: 'POST', ip: uniqueIp })
	}

	// Next request should be blocked
	const response = await callRateLimiter('/admin/api/feeds', {
		method: 'POST',
		ip: uniqueIp,
	})
	invariant(response, 'Expected response')

	expect(response.status).toBe(429)
	expect(response.headers.has('Retry-After')).toBe(true)
	expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
	expect(consoleWarn).toHaveBeenCalled()
})

test('rate limiter tracks different route types separately (admin-write exhausted, admin-read and media still work)', async () => {
	// Rate limit blocking logs a warning, which is expected
	consoleWarn.mockImplementation(() => {})

	const uniqueIp = `separate-limits-test-${Date.now()}`
	const adminWriteLimit = parseInt(TEST_RATE_LIMITS.RATE_LIMIT_ADMIN_WRITE, 10)

	// Exhaust admin-write limit
	for (let i = 0; i < adminWriteLimit; i++) {
		await callRateLimiter('/admin/api/feeds', { method: 'POST', ip: uniqueIp })
	}

	// Admin POST should be blocked
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

	// And media routes should still work
	const mediaResponse = await callRateLimiter('/media/token/file.mp3', {
		ip: uniqueIp,
	})
	invariant(mediaResponse, 'Expected response')
	expect(mediaResponse.status).toBe(200)
})
