import { baseImportMap } from '#app/config/import-map.ts'
import {
	versionedImportMap,
	versionedUrl,
} from '#app/helpers/bundle-version.ts'

export function getDocumentAssets(entryScript: string | false) {
	const versionedImports = versionedImportMap(baseImportMap)

	return {
		entryScriptUrl: entryScript ? versionedUrl(entryScript) : null,
		importmapJson: JSON.stringify({ imports: versionedImports }),
		modulePreloadUrls: Object.values(versionedImports),
	}
}
