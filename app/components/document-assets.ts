import { baseImportMap } from '#app/config/import-map.ts'
import {
	versionedImportMap,
	versionedUrl,
} from '#app/helpers/bundle-version.ts'

export function getDocumentAssets(entryScript: string | false) {
	const versionedImports = versionedImportMap(baseImportMap)
	const entryScriptUrl = entryScript ? versionedUrl(entryScript) : null

	return {
		entryScriptUrl,
		importmapJson: JSON.stringify({ imports: versionedImports }),
		modulePreloadUrls: entryScriptUrl ? Object.values(versionedImports) : [],
	}
}
