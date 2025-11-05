import type { Remix } from '@remix-run/dom'

import { ModulePreload } from './module-preload.tsx'

const importmap = {
	imports: {
		'@remix-run/dom': '/node_modules/@remix-run/dom',
		'@remix-run/events': '/node_modules/@remix-run/events',
		'@remix-run/events/press': '/node_modules/@remix-run/events/press',
		'@remix-run/style': '/node_modules/@remix-run/style',
		'@remix-run/dom/jsx-dev-runtime':
			'/node_modules/@remix-run/dom/jsx-dev-runtime',
	},
}

export function Layout({ children }: { children: Remix.RemixNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>Remix UI - Demo with Bun</title>
				<script type="importmap" innerHTML={JSON.stringify(importmap)} />
				{Object.values(importmap.imports).map((value) => (
					<ModulePreload url={value} />
				))}
				<ModulePreload url="/dist/style.js" />
			</head>
			<body>
				{children}
				<script type="module" src="/dist/entry.js" />
			</body>
		</html>
	)
}
