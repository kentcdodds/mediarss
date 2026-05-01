import { html, type SafeHtml } from 'remix/html-template'
import { getDocumentAssets } from './document-assets.ts'

export function Layout({
	children,
	title = 'MediaRSS',
	entryScript = '/app/client/entry.tsx',
}: {
	children?: SafeHtml
	title?: string
	entryScript?: string | false
}) {
	const { entryScriptUrl, importmapJson, modulePreloadUrls } =
		getDocumentAssets(entryScript)
	const importmapScript = html.raw`<script type="importmap">
		${importmapJson}
	</script>`
	const modulePreloads = modulePreloadUrls.map(
		(value) => html`<link rel="modulepreload" href="${value}" />`,
	)

	return html`<html lang="en">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>${title}</title>
			<link rel="icon" href="/favicon.ico" sizes="48x48" />
			<link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
			<link rel="stylesheet" href="/assets/styles.css" />
			${importmapScript} ${modulePreloads}
		</head>
		<body>
			<div id="root">${children ?? ''}</div>
			${entryScriptUrl
				? html`<script type="module" src="${entryScriptUrl}"></script>`
				: ''}
		</body>
	</html>`
}
