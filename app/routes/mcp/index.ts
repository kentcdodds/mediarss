/**
 * MCP (Model Context Protocol) endpoint.
 * Handles Streamable HTTP transport for MCP clients.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Action, RequestContext } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import {
	type AuthInfo,
	getAuthExtra,
	handleUnauthorized,
	resolveAuthInfo,
} from '#app/mcp/auth.ts'
import { MCP_CORS_HEADERS, withCors } from '#app/mcp/cors.ts'
import { createMcpServer, initializeMcpServer } from '#app/mcp/server.ts'
import { WebStandardStreamableHTTPServerTransport } from '#app/mcp/transport.ts'

/**
 * Session storage for active MCP sessions.
 * Maps session ID to transport and server instances.
 */
interface McpSession {
	transport: WebStandardStreamableHTTPServerTransport
	server: McpServer
	authInfo: AuthInfo
	createdAt: number
	lastActivityAt: number
}

const sessions = new Map<string, McpSession>()

// Session timeout (1 hour of inactivity)
const SESSION_TIMEOUT_MS = 60 * 60 * 1000

// Cleanup interval (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/**
 * Clean up expired sessions periodically.
 * Sessions expire after SESSION_TIMEOUT_MS of inactivity.
 */
function cleanupExpiredSessions(): void {
	const now = Date.now()
	for (const [sessionId, session] of sessions.entries()) {
		if (now - session.lastActivityAt > SESSION_TIMEOUT_MS) {
			console.log(`[MCP] Cleaning up expired session: ${sessionId}`)
			session.transport.close().catch((err) => {
				console.error(`[MCP] Error closing expired session ${sessionId}:`, err)
			})
			sessions.delete(sessionId)
		}
	}
}

/**
 * Update session activity timestamp.
 */
function touchSession(sessionId: string): void {
	const session = sessions.get(sessionId)
	if (session) {
		session.lastActivityAt = Date.now()
	}
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS)

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
 * Handle DELETE requests to close a session.
 * This allows clients to gracefully terminate their session per MCP spec.
 */
async function handleDelete(sessionId: string | null): Promise<Response> {
	if (!sessionId) {
		return new Response(
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
		)
	}

	const session = sessions.get(sessionId)
	if (!session) {
		// Session already gone - return success anyway (idempotent)
		return new Response(null, { status: 204 })
	}

	try {
		await session.transport.close()
	} catch (err) {
		console.error(`[MCP] Error closing session ${sessionId}:`, err)
	}
	sessions.delete(sessionId)

	console.log(`[MCP] Session ${sessionId} closed by client request`)
	return new Response(null, { status: 204 })
}

/**
 * Handle MCP requests (POST and GET for SSE).
 */
async function handleRequest(context: RequestContext): Promise<Response> {
	const { request } = context
	const issuer = getOrigin(request, context.url)
	const sessionId = request.headers.get('mcp-session-id')

	// Handle DELETE requests for session termination
	if (request.method === 'DELETE') {
		return handleDelete(sessionId)
	}

	// Validate authentication
	const authInfo = await resolveAuthInfo(
		request.headers.get('authorization'),
		issuer,
	)

	if (!authInfo) {
		return handleUnauthorized(request)
	}

	// Check for existing session
	let session = sessionId ? sessions.get(sessionId) : undefined

	// If we have a session, verify auth still matches and update activity
	if (session) {
		// Check if user changed or if scopes have been downgraded
		const userChanged =
			getAuthExtra(session.authInfo).sub !== getAuthExtra(authInfo).sub
		const scopesDowngraded = session.authInfo.scopes.some(
			(scope) => !authInfo.scopes.includes(scope),
		)

		if (userChanged || scopesDowngraded) {
			// Token changed or scopes reduced, invalidate session
			console.log(`[MCP] Invalidating session ${sessionId} due to auth change`)
			await session.transport.close()
			sessions.delete(sessionId!)
			session = undefined
		} else {
			// Update activity timestamp for session keepalive
			touchSession(sessionId!)
		}
	}

	// Handle initialization request
	if (!session) {
		const isInit = await isInitializationRequest(request)

		if (!isInit && sessionId) {
			// Session not found but session ID provided - may have expired
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32001,
						message:
							'Session not found. The session may have expired due to inactivity. Please reinitialize.',
					},
					id: null,
				}),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		if (!isInit) {
			// Non-init request without session
			return new Response(
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
			)
		}

		// Create new session with proper lifecycle management
		const now = Date.now()
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => crypto.randomUUID(),
			onsessioninitialized: (newSessionId) => {
				// Store session in map when SDK assigns the session ID
				// This happens during the first handleRequest call
				sessions.set(newSessionId, {
					transport,
					server,
					authInfo,
					createdAt: now,
					lastActivityAt: now,
				})
				console.log(`[MCP] Session initialized: ${newSessionId}`)
			},
		})

		// Register onclose callback to remove session from map when closed
		transport.onclose = () => {
			const sid = transport.sessionId
			if (sid && sessions.has(sid)) {
				sessions.delete(sid)
				console.log(`[MCP] Session closed: ${sid}`)
			}
		}

		// Register onerror callback to log transport errors
		transport.onerror = (error) => {
			const sid = transport.sessionId ?? 'unknown'
			console.error(`[MCP] Transport error for session ${sid}:`, error)
		}

		const server = createMcpServer()
		await initializeMcpServer(server, authInfo, issuer)
		// Note: server.connect() calls transport.start() internally
		await server.connect(transport)

		// Create local session object for this request
		// The session is stored in the map via onsessioninitialized callback
		session = {
			transport,
			server,
			authInfo,
			createdAt: now,
			lastActivityAt: now,
		}
	}

	// Handle the request
	return session.transport.handleRequest(request, {
		authInfo,
	})
}

export default {
	middleware: [],
	action: withCors({
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
} satisfies Action<typeof routes.mcp.method, typeof routes.mcp.pattern.source>
