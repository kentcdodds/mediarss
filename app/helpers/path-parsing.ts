export type ParsedMediaPath = {
	rootName: string
	relativePath: string
}

/**
 * Normalize a relative path to use forward slashes and remove redundant segments.
 * This ensures consistent path storage and comparison across platforms.
 *
 * - Replaces backslashes with forward slashes (Windows compatibility)
 * - Removes duplicate slashes (foo//bar -> foo/bar)
 * - Removes leading/trailing slashes
 * - Does NOT resolve '..' segments (that should be done with realpath for security)
 */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, '/') // Convert backslashes to forward slashes
		.replace(/\/+/g, '/') // Remove duplicate slashes
		.replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
}

/**
 * Create a canonical key for a media item (used for deduplication).
 * Normalizes the path and combines with media root.
 */
export function createMediaKey(
	mediaRoot: string,
	relativePath: string,
): string {
	return `${mediaRoot}:${normalizePath(relativePath)}`
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
