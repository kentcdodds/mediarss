/**
 * MCP (Model Context Protocol) endpoint.
 * Serves the 2026-07-28 Streamable HTTP revision per request.
 */

import { createMcpHandler } from '@modelcontextprotocol/server'
import { type Action, type RequestContext } from 'remix/router'
import type routes from '#app/config/routes.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { handleUnauthorized, resolveAuthInfo } from '#app/mcp/auth.ts'
import { MCP_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import { createMcpServer, initializeMcpServer } from '#app/mcp/server.ts'

const mcpHandler = createMcpHandler(
	async ({ authInfo, requestInfo }) => {
		if (!authInfo) {
			throw new Error('MCP requests require verified authInfo')
		}
		if (!requestInfo) {
			throw new Error('MCP requests require requestInfo')
		}

		const issuer = getOrigin(requestInfo, new URL(requestInfo.url))
		const server = createMcpServer()
		await initializeMcpServer(server, authInfo, issuer)
		return server
	},
	{
		legacy: 'reject',
		onerror(error) {
			console.error('[MCP] handler error:', error)
		},
	},
)

async function handleRequest(context: RequestContext): Promise<Response> {
	const { request } = context
	const issuer = getOrigin(request, context.url)
	const authInfo = await resolveAuthInfo(
		request.headers.get('authorization'),
		issuer,
	)

	if (!authInfo) {
		return handleUnauthorized(request)
	}

	return mcpHandler.fetch(request, { authInfo })
}

export default {
	middleware: [],
	handler: withCors({
		getCorsHeaders: () => MCP_CORS_HEADERS,
		handler: async (context: RequestContext) => {
			try {
				return await handleRequest(context)
			} catch (error) {
				console.error('MCP handler error:', error)
				return new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32603,
							message:
								error instanceof Error
									? error.message
									: 'Internal server error',
						},
						id: null,
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					},
				)
			}
		},
	}),
} satisfies Action<typeof routes.mcp>
