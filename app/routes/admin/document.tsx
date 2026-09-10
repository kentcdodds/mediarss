import { type ScriptEntry } from 'remix/assets'
import { type Handle } from 'remix/ui'
import { ImportMap } from 'remix/ui/server'
import { AdminApp } from '#app/client/admin/app-root.tsx'
import {
	noAdminRouteLoaderData,
	type AdminRouteLoaderData,
} from '#app/client/admin/loader-data.ts'

type AdminDocumentProps = {
	url: string
	loaderData?: AdminRouteLoaderData
	scriptEntry: ScriptEntry
	stylesheetHref: string
}

export function AdminDocument(handle: Handle<AdminDocumentProps>) {
	return () => {
		const { href, importMap, preloads } = handle.props.scriptEntry

		return (
			<html lang="en">
				<head>
					<meta charSet="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>MediaRSS Admin</title>
					<link rel="icon" href="/favicon.ico" sizes="48x48" />
					<link rel="icon" type="image/svg+xml" href="/logo.svg" />
					<link rel="stylesheet" href={handle.props.stylesheetHref} />
					<ImportMap value={importMap} />
					{preloads.map((preloadHref) => (
						<link key={preloadHref} rel="modulepreload" href={preloadHref} />
					))}
					<script type="module" src={href}></script>
				</head>
				<body>
					<div id="root">
						<AdminApp
							url={handle.props.url}
							loaderData={handle.props.loaderData ?? noAdminRouteLoaderData}
						/>
					</div>
				</body>
			</html>
		)
	}
}
