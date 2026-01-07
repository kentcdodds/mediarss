import { invariant } from '@epic-web/invariant'
import type { Middleware } from '@remix-run/fetch-router'
import {
	getAdminReadLimiter,
	getAdminWriteLimiter,
	getDefaultLimiter,
	getMediaLimiter,
	type RateLimiter,
} from '#app/helpers/rate-limiter.ts'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Paths that should skip rate limiting entirely */
const SKIP_PATHS = new Set(['/admin/health'])

/** Path prefixes that should skip rate limiting */
const SKIP_PREFIXES = ['/assets/']

/**
 * Check if a path should skip rate limiting.
 */
function shouldSkipRateLimit(pathname: string): boolean {
	if (SKIP_PATHS.has(pathname)) return true
	return SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Extract the client IP address from the request.
 * Checks common proxy headers first, then falls back to a default.
 */
function getClientIp(request: Request): string {
	// X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2
	const forwardedFor = request.headers.get('X-Forwarded-For')
	if (forwardedFor) {
		const firstIp = forwardedFor.split(',')[0]?.trim()
		if (firstIp) return firstIp
	}

	// X-Real-IP is typically set by nginx
	const realIp = request.headers.get('X-Real-IP')
	if (realIp) return realIp

	// Fallback for direct connections (useful in development)
	return '127.0.0.1'
}

/**
 * Determine which rate limiter to use based on the URL path and HTTP method.
 */
function getLimiter(pathname: string, method: string): RateLimiter {
	// Admin routes
	if (pathname.startsWith('/admin')) {
		if (READ_METHODS.has(method)) {
			return getAdminReadLimiter()
		}
		return getAdminWriteLimiter()
	}

	// Media enclosures
	if (pathname.startsWith('/media/')) {
		return getMediaLimiter()
	}

	// Everything else (feeds, artwork, etc.)
	return getDefaultLimiter()
}

/**
 * Rate limiting middleware.
 * Applies different rate limits based on route pattern and HTTP method.
 *
 * Skipped paths: /admin/health, /assets/*
 */
export function rateLimit(): Middleware {
	return async (context, next) => {
		const { request, url } = context

		// Skip rate limiting for health checks and static assets
		if (shouldSkipRateLimit(url.pathname)) {
			return next()
		}

		const clientIp = getClientIp(request)
		const limiter = getLimiter(url.pathname, request.method)

		// Create a unique key combining IP and limiter name
		// This allows different limits for the same IP on different route types
		const key = `${clientIp}:${limiter.getName()}`

		const result = limiter.check(key)

		if (!result.allowed) {
			const retryAfterSeconds = Math.ceil(result.resetMs / 1000)

			// Log rate limit hit
			console.warn(
				`[rate-limit] ${request.method} ${url.pathname} blocked for ${clientIp} (${limiter.getName()}: ${limiter.getMaxRequests()} req/min)`,
			)

			return new Response('Too Many Requests', {
				status: 429,
				headers: {
					'Retry-After': String(retryAfterSeconds),
					'X-RateLimit-Limit': String(limiter.getMaxRequests()),
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': String(
						Math.ceil((Date.now() + result.resetMs) / 1000),
					),
				},
			})
		}

		// Add rate limit headers to successful responses
		const response = await next()
		invariant(response, 'Expected response from next()')

		// Clone response to add headers (responses may be immutable)
		const newHeaders = new Headers(response.headers)
		newHeaders.set('X-RateLimit-Limit', String(limiter.getMaxRequests()))
		newHeaders.set('X-RateLimit-Remaining', String(result.remaining))

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		})
	}
}
