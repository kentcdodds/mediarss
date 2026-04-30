import { type Handle, type RemixNode } from 'remix/ui'
import { baseImportMap } from '#app/config/import-map.ts'
import {
	versionedImportMap,
	versionedUrl,
} from '#app/helpers/bundle-version.ts'

type ServerDocumentProps = {
	children?: RemixNode
	title?: string
	entryScript?: string | false
}

export function ServerDocument(handle: Handle<ServerDocumentProps>) {
	const {
		children,
		title = 'MediaRSS',
		entryScript = '/app/client/entry.tsx',
	} = handle.props

	return () => {
		const versionedImports = versionedImportMap(baseImportMap)
		const importmapJson = JSON.stringify({ imports: versionedImports })

		return (
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{title}</title>
					<link rel="icon" href="/favicon.ico" sizes="48x48" />
					<link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
					<link rel="stylesheet" href="/assets/styles.css" />
					<script type="importmap" innerHTML={importmapJson} />
					{Object.values(versionedImports).map((value) => (
						<link key={value} rel="modulepreload" href={value} />
					))}
				</head>
				<body>
					<div id="root">{children}</div>
					{entryScript ? (
						<script type="module" src={versionedUrl(entryScript)} />
					) : null}
				</body>
			</html>
		)
	}
}
