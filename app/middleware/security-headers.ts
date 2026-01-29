/**
 * Security headers middleware.
 * Adds common security headers to all responses.
 */

import type { Middleware } from '@remix-run/fetch-router'
import { invariant } from '@epic-web/invariant'

/**
 * Default security headers applied to all responses.
 */
const SECURITY_HEADERS = {
	// Prevent MIME type sniffing
	'X-Content-Type-Options': 'nosniff',
	// Prevent clickjacking
	'X-Frame-Options': 'DENY',
	// Enable XSS filter (legacy browsers)
	'X-XSS-Protection': '1; mode=block',
	// Prevent leaking referrer to external sites
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// Permissions Policy (formerly Feature-Policy)
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const

/**
 * Security headers middleware.
 * Adds security headers to all responses to protect against common attacks.
 *
 * Note: Strict-Transport-Security (HSTS) and Content-Security-Policy (CSP)
 * should be configured based on your deployment environment.
 */
export function securityHeaders(): Middleware {
	return async (_context, next) => {
		const response = await next()
		invariant(response, 'Expected response from next()')

		// Clone response to add headers (responses may be immutable)
		const newHeaders = new Headers(response.headers)

		// Add security headers
		for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
			// Don't override if already set
			if (!newHeaders.has(key)) {
				newHeaders.set(key, value)
			}
		}

		// Add HSTS in production (only over HTTPS)
		if (
			Bun.env.NODE_ENV === 'production' &&
			!newHeaders.has('Strict-Transport-Security')
		) {
			newHeaders.set(
				'Strict-Transport-Security',
				'max-age=31536000; includeSubDomains',
			)
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		})
	}
}
