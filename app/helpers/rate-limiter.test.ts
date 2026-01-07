import { expect, test } from 'bun:test'
import { RateLimiter } from './rate-limiter.ts'

/**
 * Creates a rate limiter that will be automatically destroyed after the test.
 */
function createTestLimiter(options: {
	name?: string
	maxRequests: number
	windowMs?: number
}) {
	const limiter = new RateLimiter({ name: options.name ?? 'test', ...options })
	return {
		limiter,
		[Symbol.dispose]: () => limiter.destroy(),
	}
}

test('RateLimiter allows requests under the limit', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	const result1 = ctx.limiter.check('ip1')
	const result2 = ctx.limiter.check('ip1')
	const result3 = ctx.limiter.check('ip1')

	expect(result1.allowed).toBe(true)
	expect(result2.allowed).toBe(true)
	expect(result3.allowed).toBe(true)
})

test('RateLimiter blocks requests over the limit', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	const result4 = ctx.limiter.check('ip1')

	expect(result4.allowed).toBe(false)
})

test('RateLimiter tracks remaining requests correctly', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	const result1 = ctx.limiter.check('ip1')
	const result2 = ctx.limiter.check('ip1')
	const result3 = ctx.limiter.check('ip1')

	expect(result1.remaining).toBe(2)
	expect(result2.remaining).toBe(1)
	expect(result3.remaining).toBe(0)
})

test('RateLimiter returns 0 remaining when blocked', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	const result4 = ctx.limiter.check('ip1')

	expect(result4.remaining).toBe(0)
})

test('RateLimiter tracks different IPs separately', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')

	// ip1 is now at limit
	expect(ctx.limiter.check('ip1').allowed).toBe(false)

	// ip2 should still be allowed
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(false)
})

test('RateLimiter.isAllowed returns true when under limit', () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 1000 })

	expect(ctx.limiter.isAllowed('ip1')).toBe(true)
	expect(ctx.limiter.isAllowed('ip1')).toBe(true)
})

test('RateLimiter.isAllowed returns false when over limit', () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 1000 })

	ctx.limiter.isAllowed('ip1')
	ctx.limiter.isAllowed('ip1')

	expect(ctx.limiter.isAllowed('ip1')).toBe(false)
})

test('RateLimiter allows requests again after window expires', async () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 100 })

	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	expect(ctx.limiter.check('ip1').allowed).toBe(false)

	// Wait for window to expire
	await new Promise((resolve) => setTimeout(resolve, 150))

	expect(ctx.limiter.check('ip1').allowed).toBe(true)
})

test('RateLimiter.resetMs indicates time until oldest request expires', async () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 200 })

	ctx.limiter.check('ip1')
	await new Promise((resolve) => setTimeout(resolve, 50))
	ctx.limiter.check('ip1')

	const blockedResult = ctx.limiter.check('ip1')

	expect(blockedResult.allowed).toBe(false)
	// resetMs should be approximately 150ms (200 - 50 elapsed)
	expect(blockedResult.resetMs).toBeGreaterThan(100)
	expect(blockedResult.resetMs).toBeLessThanOrEqual(200)
})

test('RateLimiter.getName returns the configured name', () => {
	using ctx = createTestLimiter({ name: 'my-limiter', maxRequests: 100 })
	expect(ctx.limiter.getName()).toBe('my-limiter')
})

test('RateLimiter.getMaxRequests returns the configured limit', () => {
	using ctx = createTestLimiter({ maxRequests: 100, windowMs: 60000 })
	expect(ctx.limiter.getMaxRequests()).toBe(100)
})

test('RateLimiter.getMaxRequests returns correct limit for different instances', () => {
	using ctx1 = createTestLimiter({ maxRequests: 30 })
	using ctx2 = createTestLimiter({ maxRequests: 1000 })

	expect(ctx1.limiter.getMaxRequests()).toBe(30)
	expect(ctx2.limiter.getMaxRequests()).toBe(1000)
})

test('RateLimiter uses 60 second default window when windowMs not specified', () => {
	using ctx = createTestLimiter({ maxRequests: 5 })

	// Make 5 requests
	for (let i = 0; i < 5; i++) {
		expect(ctx.limiter.check('ip1').allowed).toBe(true)
	}

	// 6th should be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)
})
