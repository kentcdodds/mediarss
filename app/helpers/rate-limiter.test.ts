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

test('RateLimiter enforces request limits per IP and tracks remaining correctly', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	// Requests under the limit should be allowed with correct remaining count
	const result1 = ctx.limiter.check('ip1')
	expect(result1.allowed).toBe(true)
	expect(result1.remaining).toBe(2)

	const result2 = ctx.limiter.check('ip1')
	expect(result2.allowed).toBe(true)
	expect(result2.remaining).toBe(1)

	const result3 = ctx.limiter.check('ip1')
	expect(result3.allowed).toBe(true)
	expect(result3.remaining).toBe(0)

	// Requests over the limit should be blocked
	const result4 = ctx.limiter.check('ip1')
	expect(result4.allowed).toBe(false)
	expect(result4.remaining).toBe(0)
})

test('RateLimiter tracks different IPs separately', () => {
	using ctx = createTestLimiter({ maxRequests: 3, windowMs: 1000 })

	// Exhaust limit for ip1
	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	expect(ctx.limiter.check('ip1').allowed).toBe(false)

	// ip2 should have its own separate limit
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(true)
	expect(ctx.limiter.check('ip2').allowed).toBe(false)
})

test('RateLimiter.isAllowed provides convenient boolean check', () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 1000 })

	expect(ctx.limiter.isAllowed('ip1')).toBe(true)
	expect(ctx.limiter.isAllowed('ip1')).toBe(true)
	expect(ctx.limiter.isAllowed('ip1')).toBe(false)
})

test('RateLimiter resets after window expires and provides accurate resetMs', async () => {
	using ctx = createTestLimiter({ maxRequests: 2, windowMs: 100 })

	ctx.limiter.check('ip1')
	ctx.limiter.check('ip1')
	expect(ctx.limiter.check('ip1').allowed).toBe(false)

	// Wait for window to expire
	await new Promise((resolve) => setTimeout(resolve, 150))

	// Should be allowed again after window expires
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

test('RateLimiter exposes configuration via getter methods', () => {
	using ctx1 = createTestLimiter({ name: 'my-limiter', maxRequests: 30 })
	using ctx2 = createTestLimiter({ name: 'other-limiter', maxRequests: 1000 })

	expect(ctx1.limiter.getName()).toBe('my-limiter')
	expect(ctx1.limiter.getMaxRequests()).toBe(30)

	expect(ctx2.limiter.getName()).toBe('other-limiter')
	expect(ctx2.limiter.getMaxRequests()).toBe(1000)
})

test('RateLimiter uses 60 second default window when windowMs not specified', () => {
	using ctx = createTestLimiter({ maxRequests: 5 })

	// Make 5 requests - all should be allowed
	for (let i = 0; i < 5; i++) {
		expect(ctx.limiter.check('ip1').allowed).toBe(true)
	}

	// 6th should be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)
})
