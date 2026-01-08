/**
 * MCP (Model Context Protocol) endpoint.
 * Handles Streamable HTTP transport for MCP clients.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Action, RequestContext } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import {
	type AuthInfo,
	handleUnauthorized,
	resolveAuthInfo,
} from '#app/mcp/auth.ts'
import { addCorsHeaders, handleCorsPrelight } from '#app/mcp/cors.ts'
import { createMcpServer, initializeMcpServer } from '#app/mcp/server.ts'
import {
	BunStreamableHTTPServerTransport,
	type RequestContext as TransportContext,
} from '#app/mcp/transport.ts'

/**
 * Session storage for active MCP sessions.
 * Maps session ID to transport and server instances.
 */
interface McpSession {
	transport: BunStreamableHTTPServerTransport
	server: McpServer
	authInfo: AuthInfo
	createdAt: number
}

const sessions = new Map<string, McpSession>()

// Session timeout (1 hour)
const SESSION_TIMEOUT_MS = 60 * 60 * 1000

/**
 * Clean up expired sessions periodically.
 */
function cleanupExpiredSessions(): void {
	const now = Date.now()
	for (const [sessionId, session] of sessions.entries()) {
		if (now - session.createdAt > SESSION_TIMEOUT_MS) {
			session.transport.close().catch(() => {})
			sessions.delete(sessionId)
		}
	}
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

/**
 * Check if a request is an initialization request.
 */
async function isInitializationRequest(request: Request): Promise<boolean> {
	// Only POST requests can be initialization
	if (request.method !== 'POST') {
		return false
	}

	// Clone the request to read the body without consuming it
	const clonedRequest = request.clone()

	try {
		const body = await clonedRequest.json()
		const messages = Array.isArray(body) ? body : [body]
		return messages.some(
			(msg: unknown) =>
				typeof msg === 'object' &&
				msg !== null &&
				'method' in msg &&
				(msg as { method: string }).method === 'initialize',
		)
	} catch {
		return false
	}
}

/**
 * Handle MCP requests.
 */
async function handleRequest(context: RequestContext): Promise<Response> {
	const { request } = context
	const issuer = `${context.url.protocol}//${context.url.host}`

	// Handle CORS preflight
	if (request.method === 'OPTIONS') {
		return handleCorsPrelight()
	}

	// Validate authentication
	const authInfo = await resolveAuthInfo(
		request.headers.get('authorization'),
		issuer,
	)

	if (!authInfo) {
		return addCorsHeaders(handleUnauthorized(request))
	}

	// Check for existing session
	const sessionId = request.headers.get('mcp-session-id')
	let session = sessionId ? sessions.get(sessionId) : undefined

	// If we have a session, verify auth matches
	if (session && session.authInfo.sub !== authInfo.sub) {
		// Token changed, invalidate session
		await session.transport.close()
		sessions.delete(sessionId!)
		session = undefined
	}

	// Handle initialization request
	if (!session) {
		const isInit = await isInitializationRequest(request)

		if (!isInit && sessionId) {
			// Session not found but session ID provided
			return addCorsHeaders(
				new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32001,
							message: 'Session not found',
						},
						id: null,
					}),
					{
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					},
				),
			)
		}

		if (!isInit) {
			// Non-init request without session
			return addCorsHeaders(
				new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32000,
							message: 'Bad Request: Mcp-Session-Id header is required',
						},
						id: null,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				),
			)
		}

		// Create new session
		const transport = new BunStreamableHTTPServerTransport({
			sessionIdGenerator: () => crypto.randomUUID(),
			onSessionInitialized: (newSessionId) => {
				sessions.set(newSessionId, {
					transport,
					server,
					authInfo,
					createdAt: Date.now(),
				})
			},
		})

		const server = createMcpServer()
		await initializeMcpServer(server, authInfo)
		await transport.start()
		await server.connect(transport)

		session = { transport, server, authInfo, createdAt: Date.now() }
	}

	// Handle the request
	const transportContext: TransportContext = {
		authInfo,
	}

	const response = await session.transport.handleRequest(
		request,
		transportContext,
	)
	return addCorsHeaders(response)
}

export default {
	middleware: [],
	async action(context: RequestContext) {
		return handleRequest(context)
	},
} satisfies Action<typeof routes.mcp.method, typeof routes.mcp.pattern.source>
