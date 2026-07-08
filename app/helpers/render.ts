import { type SafeHtml } from 'remix/html-template'
import { createHtmlResponse } from 'remix/response/html'
import { type RemixNode } from 'remix/ui'
import { renderToStream } from 'remix/ui/server'

const encoder = new TextEncoder()

export function render(body: string | SafeHtml, init?: ResponseInit) {
	return createHtmlResponse(body, init)
}

export function renderDocument(
	body: RemixNode,
	init?: ResponseInit & { request?: Request },
) {
	const renderedStream = renderToStream(body, {
		frameSrc: init?.request?.url,
		signal: init?.request?.signal,
		onError(error) {
			console.error(error)
		},
	})
	const headers = new Headers(init?.headers)
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'text/html; charset=utf-8')
	}
	return new Response(prependDoctype(renderedStream), { ...init, headers })
}

function prependDoctype(stream: ReadableStream<Uint8Array>) {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode('<!DOCTYPE html>'))
			const reader = stream.getReader()
			try {
				while (true) {
					const result = await reader.read()
					if (result.done) break
					controller.enqueue(result.value)
				}
				controller.close()
			} catch (error) {
				controller.error(error)
			} finally {
				reader.releaseLock()
			}
		},
	})
}
