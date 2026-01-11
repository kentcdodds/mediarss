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

test('RateLimiter.recordFailure applies penalty to reduce effective rate limit', () => {
	using ctx = createTestLimiter({ maxRequests: 20, windowMs: 1000 })

	// Make one successful request
	expect(ctx.limiter.check('ip1').allowed).toBe(true)

	// Record a failure with default penalty (9 additional slots)
	// Total consumed: 1 (initial) + 9 (penalty) = 10
	ctx.limiter.recordFailure('ip1')

	// Should have 10 remaining (20 - 10 = 10)
	const result = ctx.limiter.check('ip1')
	expect(result.allowed).toBe(true)
	expect(result.remaining).toBe(9) // 20 - 10 - 1 = 9

	// Make 9 more requests to exhaust the limit
	for (let i = 0; i < 9; i++) {
		expect(ctx.limiter.check('ip1').allowed).toBe(true)
	}

	// Should now be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)
})

test('RateLimiter.recordFailure with custom penalty', () => {
	using ctx = createTestLimiter({ maxRequests: 10, windowMs: 1000 })

	// Make one request
	expect(ctx.limiter.check('ip1').allowed).toBe(true)

	// Record a failure with custom penalty of 4 (total 5 consumed)
	ctx.limiter.recordFailure('ip1', 4)

	// Should have 5 remaining (10 - 5 = 5)
	const result = ctx.limiter.check('ip1')
	expect(result.allowed).toBe(true)
	expect(result.remaining).toBe(4) // 10 - 5 - 1 = 4

	// Make 4 more requests
	for (let i = 0; i < 4; i++) {
		expect(ctx.limiter.check('ip1').allowed).toBe(true)
	}

	// Should now be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)
})

test('RateLimiter.recordFailure ignores zero or negative penalty', () => {
	using ctx = createTestLimiter({ maxRequests: 5, windowMs: 1000 })

	// Make one request
	expect(ctx.limiter.check('ip1').allowed).toBe(true)

	// Record failures with zero and negative penalty (should be ignored)
	ctx.limiter.recordFailure('ip1', 0)
	ctx.limiter.recordFailure('ip1', -5)

	// Should still have 4 remaining
	const result = ctx.limiter.check('ip1')
	expect(result.allowed).toBe(true)
	expect(result.remaining).toBe(3) // 5 - 1 - 1 = 3
})

test('RateLimiter.recordFailure can immediately block after enough failures', () => {
	using ctx = createTestLimiter({ maxRequests: 10, windowMs: 1000 })

	// Make one request (1 consumed)
	expect(ctx.limiter.check('ip1').allowed).toBe(true)

	// Record failure with penalty that exhausts remaining limit
	// 1 consumed + 9 penalty = 10 (at limit)
	ctx.limiter.recordFailure('ip1')

	// Next request should be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)
})

test('RateLimiter failure penalty tracks different IPs separately', () => {
	using ctx = createTestLimiter({ maxRequests: 10, windowMs: 1000 })

	// ip1 makes a request and fails
	expect(ctx.limiter.check('ip1').allowed).toBe(true)
	ctx.limiter.recordFailure('ip1') // 10 total consumed

	// ip1 should be blocked
	expect(ctx.limiter.check('ip1').allowed).toBe(false)

	// ip2 should still have full quota
	const ip2Result = ctx.limiter.check('ip2')
	expect(ip2Result.allowed).toBe(true)
	expect(ip2Result.remaining).toBe(9) // Full limit - 1
})
