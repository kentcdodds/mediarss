/**
 * MCP-UI utility functions for widget communication with ChatGPT.
 *
 * These functions handle the message protocol between the widget iframe
 * and the ChatGPT parent frame, including:
 * - Signaling readiness
 * - Receiving initial render data
 * - Resizing the iframe
 * - Sending messages back to the parent
 */

import { parseSafe, type Schema } from 'remix/data-schema'

/**
 * Signal to the parent frame that the widget is ready.
 * Must be called after the widget is mounted.
 */
export function initMcpUi(): void {
	window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*')
}

/**
 * Update the widget iframe size.
 */
export function updateMcpUiSize(height: number, width: number): void {
	window.parent.postMessage(
		{ type: 'ui-size-change', payload: { height, width } },
		'*',
	)
}

type MessageOptions<TOutput = unknown> = {
	schema?: Schema<unknown, TOutput>
}

type McpMessageTypes = {
	tool: { toolName: string; params: Record<string, unknown> }
	prompt: { prompt: string }
	link: { url: string }
}

type McpMessageType = keyof McpMessageTypes

function sendMcpMessage<TOutput = unknown>(
	type: 'tool',
	payload: McpMessageTypes['tool'],
	options?: MessageOptions<TOutput>,
): Promise<TOutput>

function sendMcpMessage<TOutput = unknown>(
	type: 'prompt',
	payload: McpMessageTypes['prompt'],
	options?: MessageOptions<TOutput>,
): Promise<TOutput>

function sendMcpMessage<TOutput = unknown>(
	type: 'link',
	payload: McpMessageTypes['link'],
	options?: MessageOptions<TOutput>,
): Promise<TOutput>

function sendMcpMessage<TOutput = unknown>(
	type: McpMessageType,
	payload: McpMessageTypes[McpMessageType],
	options: MessageOptions<TOutput> = {},
	timeoutMs = 30000,
): Promise<TOutput> {
	const { schema } = options
	const messageId = crypto.randomUUID()

	return new Promise((resolve, reject) => {
		if (!window.parent || window.parent === window) {
			console.log(`[MCP] No parent frame available. Would have sent message:`, {
				type,
				messageId,
				payload,
			})
			reject(new Error('No parent frame available'))
			return
		}

		const timeoutId = setTimeout(() => {
			window.removeEventListener('message', handleMessage)
			reject(new Error(`MCP message '${type}' timed out after ${timeoutMs}ms`))
		}, timeoutMs)

		window.parent.postMessage({ type, messageId, payload }, '*')

		function handleMessage(event: MessageEvent) {
			if (event.data?.type !== 'ui-message-response') return
			if (event.data?.messageId !== messageId) return
			clearTimeout(timeoutId)
			window.removeEventListener('message', handleMessage)

			// Safely access payload
			const eventPayload = event.data?.payload
			if (!eventPayload) {
				return reject(new Error('Invalid response: missing payload'))
			}

			const { response, error } = eventPayload

			if (error) return reject(error)
			if (!schema) return resolve(response as TOutput)

			const parsed = parseSafe(schema, response)
			if (!parsed.success) {
				const firstIssue = parsed.issues[0]
				return reject(
					new Error(firstIssue?.message ?? 'Response validation failed'),
				)
			}

			return resolve(parsed.value)
		}

		window.addEventListener('message', handleMessage)
	})
}

export { sendMcpMessage }

/**
 * Wait for the initial render data from the parent frame.
 *
 * This signals to ChatGPT that the iframe is ready, and waits for
 * the `ui-lifecycle-iframe-render-data` message containing the
 * `initial-render-data` that was passed in `uiMetadata`.
 *
 * @param schema - Optional data schema to validate the render data
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Promise that resolves with the render data
 */
export function waitForRenderData<RenderData = unknown>(
	schema?: Schema<unknown, RenderData>,
	timeoutMs = 10000,
): Promise<RenderData> {
	return new Promise((resolve, reject) => {
		window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*')

		const timeoutId = setTimeout(() => {
			window.removeEventListener('message', handleMessage)
			reject(
				new Error(
					'Timed out waiting for render data. This widget must be opened through ChatGPT.',
				),
			)
		}, timeoutMs)

		function handleMessage(event: MessageEvent) {
			if (event.data?.type !== 'ui-lifecycle-iframe-render-data') return
			clearTimeout(timeoutId)
			window.removeEventListener('message', handleMessage)

			// Safely access payload
			const eventPayload = event.data?.payload
			if (!eventPayload) {
				return reject(
					new Error('Invalid render data response: missing payload'),
				)
			}

			const { renderData, error } = eventPayload

			if (error) return reject(error)
			if (!schema) return resolve(renderData)

			const parsed = parseSafe(schema, renderData)
			if (!parsed.success) {
				const firstIssue = parsed.issues[0]
				return reject(
					new Error(firstIssue?.message ?? 'Render data validation failed'),
				)
			}

			return resolve(parsed.value)
		}

		window.addEventListener('message', handleMessage)
	})
}
