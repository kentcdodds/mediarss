export type Range = {
	start: number
	end: number
}

/**
 * Parse HTTP Range header.
 * Returns start and end byte positions, or null if no valid range.
 */
export function parseRangeHeader(
	rangeHeader: string | null,
	fileSize: number,
): Range | null {
	if (!rangeHeader) return null

	const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
	if (!match) return null

	const [, startStr, endStr] = match
	let start = startStr ? parseInt(startStr, 10) : 0
	let end = endStr ? parseInt(endStr, 10) : fileSize - 1

	// Validate range
	if (start > end || start >= fileSize) {
		return null
	}

	// Clamp end to file size
	end = Math.min(end, fileSize - 1)

	return { start, end }
}

/**
 * Serve a file with support for HTTP Range requests.
 * Automatically handles both partial (206) and full (200) responses.
 */
export function serveFileWithRanges(
	file: ReturnType<typeof Bun.file>,
	request: Request,
	cacheControl: string,
): Response {
	const fileSize = file.size
	const contentType = file.type

	// Check for Range request
	const rangeHeader = request.headers.get('Range')
	const range = parseRangeHeader(rangeHeader, fileSize)

	if (range) {
		// Partial content response (206)
		const { start, end } = range
		const contentLength = end - start + 1

		// Slice the file for the requested range
		const slice = file.slice(start, end + 1)

		return new Response(slice, {
			status: 206,
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(contentLength),
				'Content-Range': `bytes ${start}-${end}/${fileSize}`,
				'Accept-Ranges': 'bytes',
				'Cache-Control': cacheControl,
			},
		})
	}

	// Full file response (200)
	return new Response(file, {
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(fileSize),
			'Accept-Ranges': 'bytes',
			'Cache-Control': cacheControl,
		},
	})
}
