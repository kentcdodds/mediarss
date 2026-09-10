import { html, type SafeHtml } from 'remix/html-template'
import { getStylesheetHref } from '#app/assets.ts'

/**
 * Static (non-hydrated) HTML document used by the OAuth authorization pages
 * and the 404 fallback.
 */
export async function renderLayout({
	children,
	title = 'MediaRSS',
}: {
	children?: SafeHtml
	title?: string
}) {
	const stylesheetHref = await getStylesheetHref()

	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${title}</title>
				<link rel="icon" href="/favicon.ico" sizes="48x48" />
				<link rel="icon" type="image/svg+xml" href="/logo.svg" />
				<link rel="stylesheet" href="${stylesheetHref}" />
			</head>
			<body>
				<div id="root">${children ?? ''}</div>
			</body>
		</html>`
}
