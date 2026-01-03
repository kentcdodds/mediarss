import type { SafeHtml } from '@remix-run/html-template'
import { createHtmlResponse } from '@remix-run/response/html'

export function render(body: string | SafeHtml, init?: ResponseInit) {
	return createHtmlResponse(body, init)
}
