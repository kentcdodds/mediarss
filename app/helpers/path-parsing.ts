export type ParsedMediaPath = {
	rootName: string
	relativePath: string
}

/**
 * Parse the path parameter into root name and relative path.
 * Allows empty relativePath (for admin routes that may reference just a root).
 * Format: "rootName" or "rootName/relative/path/to/file.mp3"
 */
export function parseMediaPath(pathParam: string): ParsedMediaPath | null {
	const firstSlash = pathParam.indexOf('/')
	if (firstSlash === -1) {
		// No slash means no relative path - could be just the root
		return { rootName: pathParam, relativePath: '' }
	}
	const rootName = pathParam.slice(0, firstSlash)
	const relativePath = pathParam.slice(firstSlash + 1)
	if (!rootName) {
		return null
	}
	return { rootName, relativePath }
}

/**
 * Parse the path parameter into root name and relative path.
 * Requires both rootName and relativePath (for public routes).
 * Format: "rootName/relative/path/to/file.mp3"
 */
export function parseMediaPathStrict(
	pathParam: string,
): ParsedMediaPath | null {
	const firstSlash = pathParam.indexOf('/')
	if (firstSlash === -1) {
		// No slash means no relative path - invalid
		return null
	}
	const rootName = pathParam.slice(0, firstSlash)
	const relativePath = pathParam.slice(firstSlash + 1)
	if (!rootName || !relativePath) {
		return null
	}
	return { rootName, relativePath }
}
