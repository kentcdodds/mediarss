import { createFileResponse } from 'remix/response/file'

/**
 * Serve a file with support for HTTP Range requests.
 * Node's native File/Blob support plus Remix handles range negotiation.
 */
export async function serveFileWithRanges(
	file: File,
	request: Request,
	cacheControl: string,
): Promise<Response> {
	return createFileResponse(file, request, {
		cacheControl,
	})
}
