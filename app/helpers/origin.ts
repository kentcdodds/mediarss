/**
 * Utility to get the correct origin URL when behind a reverse proxy.
 *
 * When running behind a reverse proxy like Cloudflare, Nginx, or a load balancer,
 * the connection between the proxy and the origin server is often HTTP.
 * This means `request.url` will show `http://` even when the client connected via HTTPS.
 *
 * This utility checks standard reverse proxy headers to determine the original protocol.
 */

/**
 * Get the origin URL (protocol + host) from a request, respecting reverse proxy headers.
 *
 * Checks headers in order of precedence:
 * 1. X-Forwarded-Proto - Standard header set by most proxies
 * 2. CF-Visitor - Cloudflare-specific header (contains JSON with scheme)
 * 3. Falls back to request URL protocol
 *
 * @param request - The incoming request
 * @param url - The parsed URL from the request
 * @returns The origin URL (e.g., "https://example.com")
 */
export function getOrigin(request: Request, url: URL): string {
	const proto = getProtocol(request, url)
	return `${proto}//${url.host}`
}

/**
 * Get the protocol from a request, respecting reverse proxy headers.
 *
 * @param request - The incoming request
 * @param url - The parsed URL from the request
 * @returns The protocol including trailing colon (e.g., "https:")
 */
export function getProtocol(request: Request, url: URL): string {
	// Check X-Forwarded-Proto header (standard for most proxies)
	const forwardedProto = request.headers.get('X-Forwarded-Proto')
	if (forwardedProto) {
		// Can contain multiple values separated by comma, use the first (original client)
		const proto = forwardedProto.split(',')[0]?.trim()
		if (proto === 'https' || proto === 'http') {
			return `${proto}:`
		}
	}

	// Check CF-Visitor header (Cloudflare-specific)
	const cfVisitor = request.headers.get('CF-Visitor')
	if (cfVisitor) {
		try {
			const parsed = JSON.parse(cfVisitor) as { scheme?: string }
			if (parsed.scheme === 'https' || parsed.scheme === 'http') {
				return `${parsed.scheme}:`
			}
		} catch {
			// Invalid JSON, ignore
		}
	}

	// Fall back to URL protocol
	return url.protocol
}
