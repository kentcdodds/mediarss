import { html, type SafeHtml } from 'remix/html-template'
import { createHtmlResponse } from 'remix/response/html'
import { type RemixNode } from 'remix/ui'
import { renderToString } from 'remix/ui/server'

export function render(body: string | SafeHtml, init?: ResponseInit) {
	return createHtmlResponse(body, init)
}

export async function renderComponentParts(
	body: RemixNode,
): Promise<{ head: SafeHtml; body: SafeHtml }> {
	const rendered = await renderToString(body)
	const headMatch = /^<head>([\s\S]*?)<\/head>/.exec(rendered)
	if (!headMatch) {
		return {
			head: html.raw``,
			body: html.raw`${rendered}`,
		}
	}

	const [headElement, headContents = ''] = headMatch
	return {
		head: html.raw`${headContents}`,
		body: html.raw`${rendered.slice(headElement.length)}`,
	}
}
