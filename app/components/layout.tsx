import { html, type SafeHtml } from '@remix-run/html-template'

const importmap = {
	imports: {
		'@remix-run/component': '/node_modules/@remix-run/component',
		'@remix-run/component/jsx-runtime':
			'/node_modules/@remix-run/component/jsx-runtime',
		'@remix-run/component/jsx-dev-runtime':
			'/node_modules/@remix-run/component/jsx-dev-runtime',
		'@remix-run/interaction': '/node_modules/@remix-run/interaction',
		'@remix-run/interaction/press':
			'/node_modules/@remix-run/interaction/press',
	},
}

export function Layout({
	children,
	includeEntryScript = true,
}: {
	children?: SafeHtml
	includeEntryScript?: boolean
}) {
	const importmapJson = JSON.stringify(importmap)
	const importmapScript = html.raw`<script type="importmap">${importmapJson}</script>`
	const modulePreloads = Object.values(importmap.imports).map(
		(value) => html`<link rel="modulepreload" href="${value}" />`,
	)

	return html`<html lang="en">
		<head>
			<meta charset="utf-8" />
			<title>Remix UI - Demo with Bun</title>
			<link rel="stylesheet" href="/assets/styles.css" />
			${importmapScript} ${modulePreloads}
		</head>
		<body>
			<div id="root">${children ?? ''}</div>
			${
				includeEntryScript
					? html`<script type="module" src="/dist/entry.js"></script>`
					: ''
			}
		</body>
	</html>`
}
