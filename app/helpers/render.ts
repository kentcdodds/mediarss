import { type SafeHtml } from 'remix/html-template'
import { createHtmlResponse } from 'remix/response/html'
import { type RemixNode } from 'remix/ui'
import { renderToStream } from 'remix/ui/server'

export function render(body: string | SafeHtml, init?: ResponseInit) {
	return createHtmlResponse(body, init)
}

export function renderUi(node: RemixNode, init: ResponseInit = {}) {
	const headers = new Headers(init.headers)
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'text/html; charset=utf-8')
	}

	return new Response(
		renderToStream(node, {
			onError(error) {
				console.error(error)
			},
		}),
		{
			...init,
			headers,
		},
	)
}
