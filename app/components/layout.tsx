import { html, type SafeHtml } from '@remix-run/html-template'
import { baseImportMap } from '#app/config/import-map.ts'
import {
	versionedImportMap,
	versionedUrl,
} from '#app/helpers/bundle-version.ts'

export function Layout({
	children,
	title = 'MediaRSS',
	entryScript = '/app/client/entry.tsx',
}: {
	children?: SafeHtml
	title?: string
	entryScript?: string | false
}) {
	// Apply cache-busting version to all import map URLs
	const versionedImports = versionedImportMap(baseImportMap)
	const importmap = { imports: versionedImports }

	const importmapJson = JSON.stringify(importmap)
	const importmapScript = html.raw`<script type="importmap">${importmapJson}</script>`
	const modulePreloads = Object.values(versionedImports).map(
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
			${
				entryScript
					? html`<script type="module" src="${versionedUrl(entryScript)}"></script>`
					: ''
			}
		</body>
	</html>`
}
