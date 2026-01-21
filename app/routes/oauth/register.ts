/**
 * OAuth 2.0 Dynamic Client Registration endpoint per RFC 7591.
 * This endpoint allows clients to dynamically register with the authorization server.
 */

import type { Action, RequestContext } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { REGISTRATION_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import { createClient } from '#app/oauth/clients.ts'

/**
 * Client registration request per RFC 7591.
 */
interface ClientRegistrationRequest {
	redirect_uris: string[]
	client_name?: string
	token_endpoint_auth_method?: string
	grant_types?: string[]
	response_types?: string[]
	scope?: string
}

/**
 * Client registration response per RFC 7591.
 */
interface ClientRegistrationResponse {
	client_id: string
	client_name?: string
	redirect_uris: string[]
	token_endpoint_auth_method: string
	grant_types: string[]
	response_types: string[]
	client_id_issued_at: number
}

/**
 * Validate the client registration request.
 */
function validateRegistrationRequest(
	data: unknown,
): ClientRegistrationRequest | { error: string; error_description: string } {
	if (typeof data !== 'object' || data === null) {
		return {
			error: 'invalid_client_metadata',
			error_description: 'Request body must be a JSON object',
		}
	}

	const req = data as Record<string, unknown>

	// redirect_uris is REQUIRED per RFC 7591
	if (!Array.isArray(req.redirect_uris)) {
		return {
			error: 'invalid_redirect_uri',
			error_description: 'redirect_uris must be an array',
		}
	}

	if (req.redirect_uris.length === 0) {
		return {
			error: 'invalid_redirect_uri',
			error_description: 'redirect_uris must not be empty',
		}
	}

	// Validate each redirect URI
	for (const uri of req.redirect_uris) {
		if (typeof uri !== 'string') {
			return {
				error: 'invalid_redirect_uri',
				error_description: 'All redirect_uris must be strings',
			}
		}
		try {
			new URL(uri)
		} catch {
			return {
				error: 'invalid_redirect_uri',
				error_description: `Invalid redirect URI format: ${uri}`,
			}
		}
	}

	// Validate client_name if provided
	if (req.client_name !== undefined && typeof req.client_name !== 'string') {
		return {
			error: 'invalid_client_metadata',
			error_description: 'client_name must be a string',
		}
	}

	// Validate token_endpoint_auth_method if provided
	if (req.token_endpoint_auth_method !== undefined) {
		if (typeof req.token_endpoint_auth_method !== 'string') {
			return {
				error: 'invalid_client_metadata',
				error_description: 'token_endpoint_auth_method must be a string',
			}
		}
		// We only support 'none' for public clients
		if (req.token_endpoint_auth_method !== 'none') {
			return {
				error: 'invalid_client_metadata',
				error_description:
					'Only token_endpoint_auth_method "none" is supported',
			}
		}
	}

	// Validate grant_types if provided
	if (req.grant_types !== undefined) {
		if (!Array.isArray(req.grant_types)) {
			return {
				error: 'invalid_client_metadata',
				error_description: 'grant_types must be an array',
			}
		}
		for (const gt of req.grant_types) {
			if (typeof gt !== 'string') {
				return {
					error: 'invalid_client_metadata',
					error_description: 'All grant_types must be strings',
				}
			}
		}
		// We only support authorization_code
		if (!req.grant_types.includes('authorization_code')) {
			return {
				error: 'invalid_client_metadata',
				error_description: 'grant_types must include "authorization_code"',
			}
		}
	}

	// Validate response_types if provided
	if (req.response_types !== undefined) {
		if (!Array.isArray(req.response_types)) {
			return {
				error: 'invalid_client_metadata',
				error_description: 'response_types must be an array',
			}
		}
		for (const rt of req.response_types) {
			if (typeof rt !== 'string') {
				return {
					error: 'invalid_client_metadata',
					error_description: 'All response_types must be strings',
				}
			}
		}
	}

	return {
		redirect_uris: req.redirect_uris as string[],
		client_name: req.client_name as string | undefined,
		token_endpoint_auth_method: req.token_endpoint_auth_method as
			| string
			| undefined,
		grant_types: req.grant_types as string[] | undefined,
		response_types: req.response_types as string[] | undefined,
		scope: req.scope as string | undefined,
	}
}

async function handlePost(context: RequestContext): Promise<Response> {
	const contentType = context.request.headers.get('Content-Type')
	if (!contentType?.includes('application/json')) {
		return Response.json(
			{
				error: 'invalid_client_metadata',
				error_description: 'Content-Type must be application/json',
			},
			{ status: 400 },
		)
	}

	let body: unknown
	try {
		body = await context.request.json()
	} catch {
		return Response.json(
			{
				error: 'invalid_client_metadata',
				error_description: 'Request body must be valid JSON',
			},
			{ status: 400 },
		)
	}

	const validated = validateRegistrationRequest(body)

	if ('error' in validated) {
		return Response.json(validated, { status: 400 })
	}

	// Create the client
	const clientName = validated.client_name ?? `Dynamic Client ${Date.now()}`
	const client = createClient(clientName, validated.redirect_uris)

	// Build response per RFC 7591
	const response: ClientRegistrationResponse = {
		client_id: client.id,
		client_name: client.name,
		redirect_uris: client.redirectUris,
		token_endpoint_auth_method: 'none',
		grant_types: validated.grant_types ?? ['authorization_code'],
		response_types: validated.response_types ?? ['code'],
		client_id_issued_at: client.createdAt,
	}

	return Response.json(response, {
		status: 201,
		headers: {
			'Cache-Control': 'no-store',
		},
	})
}

export default {
	middleware: [],
	action: withCors({
		getCorsHeaders: () => REGISTRATION_CORS_HEADERS,
		handler: async (context: RequestContext) => {
			if (context.method !== 'POST') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'POST, OPTIONS' },
				})
			}

			return handlePost(context)
		},
	}),
} satisfies Action<
	typeof routes.oauthRegister.method,
	typeof routes.oauthRegister.pattern.source
>
