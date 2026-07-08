import { type Handle } from 'remix/ui'
import { AdminApp } from '#app/client/admin/app-root.tsx'
import { versionedUrl } from '#app/helpers/bundle-version.ts'

type AdminDocumentProps = {
	url: string
}

const ADMIN_ENTRY_SCRIPT = '/app/client/admin/entry.tsx'

export function AdminDocument(handle: Handle<AdminDocumentProps>) {
	const entryScriptHref = versionedUrl(ADMIN_ENTRY_SCRIPT)

	return () => (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>MediaRSS Admin</title>
				<link rel="icon" href="/favicon.ico" sizes="48x48" />
				<link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
				<link rel="stylesheet" href="/assets/styles.css" />
				<link rel="modulepreload" href={entryScriptHref} />
			</head>
			<body>
				<div id="root">
					<AdminApp url={handle.props.url} />
				</div>
				<script type="module" src={entryScriptHref}></script>
			</body>
		</html>
	)
}
