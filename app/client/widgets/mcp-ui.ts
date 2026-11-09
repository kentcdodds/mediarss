/**
 * MCP-UI render-data handshake for the media player widget iframe.
 *
 * Signals readiness to the ChatGPT parent frame and waits for
 * `ui-lifecycle-iframe-render-data` containing `initial-render-data`.
 */

import { parseSafe, type Schema } from 'remix/data-schema'

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
