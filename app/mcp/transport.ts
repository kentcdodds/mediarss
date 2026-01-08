/**
 * Bun-compatible Streamable HTTP transport for MCP.
 *
 * This transport implements the MCP Streamable HTTP protocol using Web API
 * Request/Response instead of Node.js streams, making it compatible with Bun.
 *
 * Based on the MCP SDK's StreamableHTTPServerTransport but adapted for Bun's
 * native HTTP handling.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
	type JSONRPCError,
	type JSONRPCMessage,
	JSONRPCMessageSchema,
	type JSONRPCRequest,
	type JSONRPCResponse,
} from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from './auth.ts'

const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26']
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

/**
 * Check if a message is a JSON-RPC request.
 */
function isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
	return 'method' in message && 'id' in message
}

/**
 * Check if a message is an initialization request.
 */
function isInitializeRequest(message: JSONRPCMessage): boolean {
	return isJSONRPCRequest(message) && message.method === 'initialize'
}

/**
 * Check if a message is a JSON-RPC response.
 */
function isJSONRPCResponse(
	message: JSONRPCMessage,
): message is JSONRPCResponse {
	return 'result' in message && 'id' in message
}

/**
 * Check if a message is a JSON-RPC error.
 */
function isJSONRPCError(message: JSONRPCMessage): message is JSONRPCError {
	return 'error' in message && 'id' in message
}

export interface TransportOptions {
	/**
	 * Function to generate session IDs.
	 * If undefined, session management is disabled (stateless mode).
	 */
	sessionIdGenerator?: () => string

	/**
	 * Callback when a session is initialized.
	 */
	onSessionInitialized?: (sessionId: string) => void | Promise<void>
}

export interface RequestContext {
	authInfo: AuthInfo
}

/**
 * Bun-compatible Streamable HTTP Server Transport.
 *
 * This implements the MCP Streamable HTTP transport protocol using Web APIs
 * (Request/Response) instead of Node.js streams.
 */
export class BunStreamableHTTPServerTransport implements Transport {
	// sessionId must be public to satisfy the Transport interface
	sessionId?: string
	private sessionIdGenerator?: () => string
	private onSessionInitialized?: (sessionId: string) => void | Promise<void>
	private initialized = false
	private started = false

	// SSE stream management
	private sseController?: ReadableStreamDefaultController<Uint8Array>
	private pendingResponses = new Map<
		string | number,
		{
			resolve: (message: JSONRPCMessage) => void
			reject: (error: Error) => void
		}
	>()
	private requestIdToStreamId = new Map<string | number, string>()
	private streamControllers = new Map<
		string,
		ReadableStreamDefaultController<Uint8Array>
	>()

	// Transport interface callbacks
	onclose?: () => void
	onerror?: (error: Error) => void
	// Use 'unknown' for extra to be compatible with MCP SDK's Transport interface
	// The actual type is { authInfo?: AuthInfo } but we can't declare that directly
	// due to interface compatibility issues with the SDK
	onmessage?: (message: JSONRPCMessage, extra?: unknown) => void

	constructor(options: TransportOptions = {}) {
		this.sessionIdGenerator = options.sessionIdGenerator
		this.onSessionInitialized = options.onSessionInitialized
	}

	/**
	 * Get the session ID for this transport.
	 */
	getSessionId(): string | undefined {
		return this.sessionId
	}

	/**
	 * Start the transport (required by Transport interface).
	 */
	async start(): Promise<void> {
		if (this.started) {
			throw new Error('Transport already started')
		}
		this.started = true
	}

	/**
	 * Close the transport.
	 */
	async close(): Promise<void> {
		// Close all SSE streams
		for (const controller of this.streamControllers.values()) {
			try {
				controller.close()
			} catch {
				// Ignore errors when closing
			}
		}
		this.streamControllers.clear()

		if (this.sseController) {
			try {
				this.sseController.close()
			} catch {
				// Ignore errors when closing
			}
			this.sseController = undefined
		}

		this.pendingResponses.clear()
		this.requestIdToStreamId.clear()
		this.onclose?.()
	}

	/**
	 * Send a message to the client.
	 */
	async send(
		message: JSONRPCMessage,
		options?: { relatedRequestId?: string | number },
	): Promise<void> {
		let requestId = options?.relatedRequestId

		if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
			requestId = message.id
		}

		// For notifications without a related request, use the standalone SSE stream
		if (requestId === undefined) {
			if (this.sseController) {
				this.writeSSEEvent(this.sseController, message)
			}
			return
		}

		// Find the stream for this request
		const streamId = this.requestIdToStreamId.get(requestId)
		const controller = streamId
			? this.streamControllers.get(streamId)
			: undefined

		if (controller) {
			this.writeSSEEvent(controller, message)
		}

		// If this is a response, clean up and potentially close the stream
		if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
			const pending = this.pendingResponses.get(requestId)
			if (pending) {
				pending.resolve(message)
				this.pendingResponses.delete(requestId)
			}

			// Check if all requests for this stream have responses
			if (streamId) {
				const hasMorePending = Array.from(
					this.requestIdToStreamId.entries(),
				).some(([id, sid]) => sid === streamId && this.pendingResponses.has(id))

				if (!hasMorePending && controller) {
					// All responses sent, close the stream
					try {
						controller.close()
					} catch {
						// Ignore
					}
					this.streamControllers.delete(streamId)

					// Clean up request mappings for this stream
					for (const [id, sid] of this.requestIdToStreamId.entries()) {
						if (sid === streamId) {
							this.requestIdToStreamId.delete(id)
						}
					}
				}
			}
		}
	}

	/**
	 * Write an SSE event to a stream controller.
	 */
	private writeSSEEvent(
		controller: ReadableStreamDefaultController<Uint8Array>,
		message: JSONRPCMessage,
		eventId?: string,
	): void {
		let eventData = `event: message\n`
		if (eventId) {
			eventData += `id: ${eventId}\n`
		}
		eventData += `data: ${JSON.stringify(message)}\n\n`

		const encoder = new TextEncoder()
		try {
			controller.enqueue(encoder.encode(eventData))
		} catch (error) {
			this.onerror?.(error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Handle an incoming HTTP request.
	 */
	async handleRequest(
		request: Request,
		context: RequestContext,
	): Promise<Response> {
		if (request.method === 'POST') {
			return this.handlePostRequest(request, context)
		} else if (request.method === 'GET') {
			return this.handleGetRequest(request, context)
		} else if (request.method === 'DELETE') {
			return this.handleDeleteRequest(request, context)
		}

		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Method not allowed',
				},
				id: null,
			}),
			{
				status: 405,
				headers: {
					Allow: 'GET, POST, DELETE',
					'Content-Type': 'application/json',
				},
			},
		)
	}

	/**
	 * Handle GET requests for SSE stream.
	 */
	private async handleGetRequest(
		request: Request,
		_context: RequestContext,
	): Promise<Response> {
		const acceptHeader = request.headers.get('accept')
		if (!acceptHeader?.includes('text/event-stream')) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Not Acceptable: Client must accept text/event-stream',
					},
					id: null,
				}),
				{
					status: 406,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Validate session
		if (!this.validateSession(request)) {
			return this.sessionError(request)
		}

		// Check if there's already an active standalone SSE stream
		if (this.sseController) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Conflict: Only one SSE stream is allowed per session',
					},
					id: null,
				}),
				{
					status: 409,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Create SSE stream
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.sseController = controller
			},
			cancel: () => {
				this.sseController = undefined
			},
		})

		const headers: Record<string, string> = {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
		}

		if (this.sessionId) {
			headers['mcp-session-id'] = this.sessionId
		}

		return new Response(stream, { headers })
	}

	/**
	 * Handle POST requests with JSON-RPC messages.
	 */
	private async handlePostRequest(
		request: Request,
		context: RequestContext,
	): Promise<Response> {
		// Validate Accept header
		const acceptHeader = request.headers.get('accept')
		if (
			!acceptHeader?.includes('application/json') ||
			!acceptHeader.includes('text/event-stream')
		) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message:
							'Not Acceptable: Client must accept both application/json and text/event-stream',
					},
					id: null,
				}),
				{
					status: 406,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Validate Content-Type
		const contentType = request.headers.get('content-type')
		if (!contentType?.includes('application/json')) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message:
							'Unsupported Media Type: Content-Type must be application/json',
					},
					id: null,
				}),
				{
					status: 415,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Parse the request body
		let rawMessage: unknown
		try {
			rawMessage = await request.json()
		} catch {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32700,
						message: 'Parse error',
					},
					id: null,
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Parse messages
		let messages: JSONRPCMessage[]
		try {
			if (Array.isArray(rawMessage)) {
				messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg))
			} else {
				messages = [JSONRPCMessageSchema.parse(rawMessage)]
			}
		} catch (error) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32700,
						message: 'Parse error',
						data: String(error),
					},
					id: null,
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Check for initialization request
		const isInit = messages.some(isInitializeRequest)

		if (isInit) {
			// Handle initialization
			if (this.initialized && this.sessionId !== undefined) {
				return new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Invalid Request: Server already initialized',
						},
						id: null,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				)
			}

			if (messages.length > 1) {
				return new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message:
								'Invalid Request: Only one initialization request is allowed',
						},
						id: null,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				)
			}

			this.sessionId = this.sessionIdGenerator?.()
			this.initialized = true

			if (this.sessionId && this.onSessionInitialized) {
				await Promise.resolve(this.onSessionInitialized(this.sessionId))
			}
		} else {
			// Validate session for non-initialization requests
			if (!this.validateSession(request)) {
				return this.sessionError(request)
			}

			// Validate protocol version
			if (!this.validateProtocolVersion(request)) {
				return this.protocolVersionError()
			}
		}

		// Check if there are any requests (not just notifications)
		const hasRequests = messages.some(isJSONRPCRequest)

		if (!hasRequests) {
			// Only notifications or responses - return 202
			for (const message of messages) {
				this.onmessage?.(message, { authInfo: context.authInfo })
			}
			return new Response(null, { status: 202 })
		}

		// Create SSE stream for responses
		const streamId = crypto.randomUUID()

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.streamControllers.set(streamId, controller)
			},
			cancel: () => {
				this.streamControllers.delete(streamId)
			},
		})

		// Set up request tracking
		for (const message of messages) {
			if (isJSONRPCRequest(message)) {
				this.requestIdToStreamId.set(message.id, streamId)
				this.pendingResponses.set(message.id, {
					resolve: () => {},
					reject: () => {},
				})
			}
		}

		// Process messages asynchronously
		for (const message of messages) {
			this.onmessage?.(message, { authInfo: context.authInfo })
		}

		const headers: Record<string, string> = {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		}

		if (this.sessionId) {
			headers['mcp-session-id'] = this.sessionId
		}

		return new Response(stream, { headers })
	}

	/**
	 * Handle DELETE requests to terminate session.
	 */
	private async handleDeleteRequest(
		request: Request,
		_context: RequestContext,
	): Promise<Response> {
		if (!this.validateSession(request)) {
			return this.sessionError(request)
		}

		await this.close()

		return new Response(null, { status: 200 })
	}

	/**
	 * Validate the session ID from the request.
	 */
	private validateSession(request: Request): boolean {
		// If no session ID generator, session management is disabled
		if (this.sessionIdGenerator === undefined) {
			return true
		}

		// If not initialized, reject
		if (!this.initialized) {
			return false
		}

		const sessionId = request.headers.get('mcp-session-id')
		if (!sessionId) {
			return false
		}

		return sessionId === this.sessionId
	}

	/**
	 * Create a session error response.
	 */
	private sessionError(request: Request): Response {
		const sessionId = request.headers.get('mcp-session-id')

		if (!this.initialized) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Bad Request: Server not initialized',
					},
					id: null,
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

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

		// Invalid session ID
		return new Response(
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
		)
	}

	/**
	 * Validate the protocol version header.
	 */
	private validateProtocolVersion(request: Request): boolean {
		const version =
			request.headers.get('mcp-protocol-version') ?? DEFAULT_PROTOCOL_VERSION
		return SUPPORTED_PROTOCOL_VERSIONS.includes(version)
	}

	/**
	 * Create a protocol version error response.
	 */
	private protocolVersionError(): Response {
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: `Bad Request: Unsupported protocol version (supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')})`,
				},
				id: null,
			}),
			{
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	}
}
