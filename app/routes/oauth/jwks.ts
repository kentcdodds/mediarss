import type { BuildAction, RequestContext } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { DISCOVERY_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import { getPublicKeyJwk } from '#app/oauth/index.ts'

/**
 * GET /oauth/jwks - JWKS endpoint
 * Exposes the public key for verifying JWT access tokens.
 */
async function handleGet(): Promise<Response> {
	const publicKey = await getPublicKeyJwk()

	// Return as a JWKS (JSON Web Key Set)
	const jwks = {
		keys: [publicKey],
	}

	return Response.json(jwks, {
		headers: {
			'Content-Type': 'application/json',
			// Cache for 1 hour, keys rarely change
			'Cache-Control': 'public, max-age=3600',
		},
	})
}

export default {
	middleware: [],
	action: withCors({
		getCorsHeaders: () => DISCOVERY_CORS_HEADERS,
		handler: async (context: RequestContext) => {
			if (context.method !== 'GET') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'GET, OPTIONS' },
				})
			}
			return handleGet()
		},
	}),
} satisfies BuildAction<
	typeof routes.oauthJwks.method,
	typeof routes.oauthJwks.pattern
>
