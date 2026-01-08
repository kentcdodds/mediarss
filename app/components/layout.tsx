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
		'match-sorter': '/node_modules/match-sorter',
	},
}

export function Layout({
	children,
	title = 'MediaRSS',
	entryScript = '/app/client/entry.tsx',
}: {
	children?: SafeHtml
	title?: string
	entryScript?: string | false
}) {
	const importmapJson = JSON.stringify(importmap)
	const importmapScript = html.raw`<script type="importmap">${importmapJson}</script>`
	const modulePreloads = Object.values(importmap.imports).map(
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
					? html`<script type="module" src="${entryScript}"></script>`
					: ''
			}
		</body>
	</html>`
}
