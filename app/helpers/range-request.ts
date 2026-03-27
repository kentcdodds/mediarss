import { createFileResponse } from 'remix/response/file'
import { createLazyFile } from '#app/helpers/node-file.ts'

function isMalformedRangeRequest(request: Request): boolean {
	const rangeHeader = request.headers.get('Range')
	if (!rangeHeader) return false
	return !/^bytes=(\d*-\d*)(\s*,\s*\d*-\d*)*$/.test(rangeHeader.trim())
}

/**
 * Serve a file with support for HTTP Range requests.
 * Node's native File/Blob support plus Remix handles range negotiation.
 */
export async function serveFileWithRanges(
	filePath: string,
	request: Request,
	cacheControl: string,
): Promise<Response> {
	const file = await createLazyFile(filePath)
	if (!file) {
		return new Response('File not found', { status: 404 })
	}

	if (isMalformedRangeRequest(request)) {
		const sanitizedHeaders = new Headers(request.headers)
		sanitizedHeaders.delete('Range')
		request = new Request(request, { headers: sanitizedHeaders })
	}

	return createFileResponse(file, request, {
		cacheControl,
	})
}
