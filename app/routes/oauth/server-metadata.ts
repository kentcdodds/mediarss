import type { Action, RequestContext } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { DISCOVERY_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'

/**
 * OAuth Authorization Server Metadata per RFC 8414.
 * This endpoint provides metadata about the authorization server
 * capabilities and endpoints.
 */

export interface AuthorizationServerMetadata {
	issuer: string
	authorization_endpoint: string
	token_endpoint: string
	jwks_uri: string
	registration_endpoint: string
	response_types_supported: string[]
	grant_types_supported: string[]
	code_challenge_methods_supported: string[]
	token_endpoint_auth_methods_supported: string[]
	// MCP-specific extension: indicates support for client ID metadata documents
	client_id_metadata_document_supported: boolean
}

function handleGet(context: RequestContext): Response {
	const origin = `${context.url.protocol}//${context.url.host}`

	const metadata: AuthorizationServerMetadata = {
		issuer: origin,
		authorization_endpoint: `${origin}/admin/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		jwks_uri: `${origin}/oauth/jwks`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		// MCP 2025-11-25: Indicate support for client ID metadata documents
		client_id_metadata_document_supported: true,
	}

	return Response.json(metadata, {
		headers: {
			'Cache-Control': 'public, max-age=3600',
		},
	})
}

export default {
	middleware: [],
	action: withCors({
		getCorsHeaders: () => DISCOVERY_CORS_HEADERS,
		handler: (context: RequestContext) => {
			if (context.method !== 'GET') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'GET, OPTIONS' },
				})
			}
			return handleGet(context)
		},
	}),
} satisfies Action<
	typeof routes.oauthServerMetadata.method,
	typeof routes.oauthServerMetadata.pattern.source
>
