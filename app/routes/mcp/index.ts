/**
 * MCP (Model Context Protocol) endpoint.
 * Serves the 2026-07-28 Streamable HTTP revision per request.
 */

import { createMcpHandler } from '@modelcontextprotocol/server'
import { type Action, type RequestContext } from 'remix/router'
import type routes from '#app/config/routes.ts'
import { recordDiagnostic } from '#app/helpers/diagnostics.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { handleUnauthorized, resolveAuthInfo } from '#app/mcp/auth.ts'
import { MCP_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import { validateModernProtocolHeaders } from '#app/mcp/protocol-headers.ts'
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
			recordDiagnostic({
				area: 'mcp',
				event: 'handler_error',
				ok: false,
				detail: {
					message: error instanceof Error ? error.message : String(error),
				},
			})
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
		recordDiagnostic({
			area: 'mcp',
			event: 'unauthorized',
			ok: false,
			detail: { method: request.method },
		})
		return handleUnauthorized(request)
	}

	if (request.method === 'POST') {
		let body: unknown
		try {
			body = await request.clone().json()
		} catch {
			body = undefined
		}
		const rejected = validateModernProtocolHeaders(request, body)
		if (rejected) {
			recordDiagnostic({
				area: 'mcp',
				event: 'header_mismatch',
				ok: false,
				detail: {
					rpcMethod: jsonRpcMethod(body),
					protocolVersion: request.headers.get('mcp-protocol-version'),
				},
			})
			return rejected
		}

		const response = await mcpHandler.fetch(request, { authInfo })
		if (!response.ok) {
			recordDiagnostic({
				area: 'mcp',
				event: 'handler_rejected',
				ok: false,
				detail: {
					rpcMethod: jsonRpcMethod(body),
					httpStatus: response.status,
					...(await jsonRpcErrorDetail(response.clone())),
				},
			})
		}
		return response
	}

	return mcpHandler.fetch(request, { authInfo })
}

function jsonRpcMethod(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null
	if (!('method' in body) || typeof body.method !== 'string') return null
	return body.method
}

async function jsonRpcErrorDetail(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		const body = (await response.json()) as {
			error?: { code?: number; message?: string }
		}
		return {
			...(typeof body.error?.code === 'number'
				? { rpcCode: body.error.code }
				: {}),
			...(typeof body.error?.message === 'string'
				? { rpcMessage: body.error.message }
				: {}),
		}
	} catch {
		return {}
	}
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
				recordDiagnostic({
					area: 'mcp',
					event: 'unhandled_error',
					ok: false,
					detail: {
						message: error instanceof Error ? error.message : String(error),
					},
				})
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
