/**
 * Decode a URL-encoded path parameter.
 * Returns null when the encoded value is malformed.
 */
export function decodePathParam(pathParam: string): string | null {
	try {
		return decodeURIComponent(pathParam)
	} catch {
		return null
	}
}
