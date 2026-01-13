/**
 * Admin authentication middleware.
 *
 * IMPORTANT: By default, admin routes are NOT protected.
 * You must configure one of the authentication methods below for production use.
 *
 * Options:
 * 1. Set ADMIN_PASSWORD environment variable for basic auth
 * 2. Set CLOUDFLARE_ACCESS_TEAM_DOMAIN for Cloudflare Access JWT validation
 * 3. Implement custom authentication logic
 *
 * The admin UI and all /admin/api/* routes will be protected when enabled.
 */

import type { Middleware } from '@remix-run/fetch-router'

/**
 * Check if admin authentication is enabled.
 */
export function isAdminAuthEnabled(): boolean {
	return Boolean(
		Bun.env.ADMIN_PASSWORD || Bun.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
	)
}

/**
 * Basic authentication handler.
 * Validates credentials against ADMIN_PASSWORD environment variable.
 */
function validateBasicAuth(authHeader: string | null): boolean {
	const adminPassword = Bun.env.ADMIN_PASSWORD
	if (!adminPassword) return false

	if (!authHeader?.startsWith('Basic ')) return false

	try {
		const base64Credentials = authHeader.slice(6)
		const credentials = atob(base64Credentials)
		const [_username, password] = credentials.split(':')

		// Username can be anything, we only check password
		return password === adminPassword
	} catch {
		return false
	}
}

/**
 * Cloudflare Access JWT validation.
 * Validates the CF-Access-JWT-Assertion header.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
async function validateCloudflareAccess(request: Request): Promise<boolean> {
	const teamDomain = Bun.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN
	if (!teamDomain) return false

	const jwtAssertion =
		request.headers.get('CF-Access-JWT-Assertion') ||
		request.headers.get('cf-access-jwt-assertion')

	if (!jwtAssertion) return false

	try {
		// Fetch Cloudflare Access public keys
		const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`
		const certsResponse = await fetch(certsUrl)
		if (!certsResponse.ok) {
			console.error('[admin-auth] Failed to fetch Cloudflare Access certs')
			return false
		}

		const { keys } = (await certsResponse.json()) as {
			keys: Array<JsonWebKey>
		}

		// Import jose dynamically to avoid bundling issues
		const jose = await import('jose')

		// Try each key until one works
		for (const key of keys) {
			try {
				const publicKey = await jose.importJWK(key, 'RS256')
				const { payload } = await jose.jwtVerify(jwtAssertion, publicKey, {
					issuer: `https://${teamDomain}`,
					audience: teamDomain,
				})

				// Token is valid
				return Boolean(payload)
			} catch {}
		}

		return false
	} catch (error) {
		console.error('[admin-auth] Cloudflare Access validation error:', error)
		return false
	}
}

/**
 * Generate a 401 Unauthorized response with WWW-Authenticate header.
 */
function unauthorizedResponse(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="MediaRSS Admin"',
		},
	})
}

/**
 * Admin authentication middleware.
 *
 * Applies to routes starting with /admin.
 *
 * When authentication is not configured (no ADMIN_PASSWORD or
 * CLOUDFLARE_ACCESS_TEAM_DOMAIN), all requests are allowed but a
 * warning is logged in production.
 */
export function adminAuth(): Middleware {
	// Log warning if auth is not configured
	if (!isAdminAuthEnabled()) {
		if (Bun.env.NODE_ENV === 'production') {
			console.warn(
				'[security] Admin authentication is NOT configured. Set ADMIN_PASSWORD or CLOUDFLARE_ACCESS_TEAM_DOMAIN.',
			)
		}
	}

	return async (context, next) => {
		const { url, request } = context

		// Only apply to admin routes
		if (!url.pathname.startsWith('/admin')) {
			return next()
		}

		// Skip auth for health check endpoint
		if (url.pathname === '/admin/health') {
			return next()
		}

		// If no auth is configured, allow all (but warn in production above)
		if (!isAdminAuthEnabled()) {
			return next()
		}

		// Try Basic Auth first (ADMIN_PASSWORD)
		const authHeader = request.headers.get('Authorization')
		if (Bun.env.ADMIN_PASSWORD && validateBasicAuth(authHeader)) {
			return next()
		}

		// Try Cloudflare Access
		if (Bun.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN) {
			const isValid = await validateCloudflareAccess(request)
			if (isValid) {
				return next()
			}
		}

		// Authentication failed
		return unauthorizedResponse()
	}
}
