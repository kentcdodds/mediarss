/**
 * Parse the best-effort client IP from request headers.
 */
export function getClientIp(request: Request): string | null {
	const forwardedFor = request.headers.get('X-Forwarded-For')
	if (forwardedFor) {
		for (const candidate of forwardedFor.split(',')) {
			const trimmedCandidate = candidate.trim()
			if (trimmedCandidate && trimmedCandidate.toLowerCase() !== 'unknown') {
				return trimmedCandidate
			}
		}
	}

	const realIp = request.headers.get('X-Real-IP')?.trim()
	if (realIp && realIp.toLowerCase() !== 'unknown') return realIp

	return null
}

/**
 * Return a trimmed User-Agent string if present.
 */
export function getUserAgent(request: Request): string | null {
	const userAgent = request.headers.get('User-Agent')?.trim()
	return userAgent || null
}

/**
 * Build a stable, non-cryptographic fingerprint from request traits.
 * We avoid persisting raw IP addresses in analytics rows.
 */
export function getClientFingerprint(request: Request): string | null {
	const ip = getClientIp(request)
	const userAgent = getUserAgent(request)
	if (!ip && !userAgent) return null
	const source = `${ip ?? ''}|${userAgent ?? ''}`

	let hash = 5381
	for (let i = 0; i < source.length; i++) {
		hash = (hash * 33) ^ source.charCodeAt(i)
	}

	return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Best-effort client app extraction from User-Agent.
 */
export function getClientName(request: Request): string | null {
	const userAgent = getUserAgent(request)
	if (!userAgent) return null

	const knownClients = [
		'AppleCoreMedia',
		'Apple Podcasts',
		'Pocket Casts',
		'Overcast',
		'Spotify',
		'Castro',
		'AntennaPod',
		'Podcast Addict',
		'Google Podcasts',
		'VLC',
		'curl',
		'wget',
	]

	for (const client of knownClients) {
		if (userAgent.toLowerCase().includes(client.toLowerCase())) {
			return client
		}
	}

	const firstToken = userAgent.split(' ')[0]?.trim()
	return firstToken || null
}

/**
 * Determine whether a media request looks like a playback/download start.
 */
export function isDownloadStartRequest(request: Request): boolean {
	const range = request.headers.get('Range')?.trim()
	if (!range) return true

	const match = range.match(/^bytes=(\d+)-(\d*)$/)
	if (!match) return false

	const start = Number.parseInt(match[1] ?? '0', 10)
	return start === 0
}

/**
 * Parse Content-Length as number when available.
 */
export function getResponseBytesServed(response: Response): number | null {
	const contentLength = response.headers.get('Content-Length')
	if (!contentLength) return null
	const parsed = Number.parseInt(contentLength, 10)
	if (!Number.isFinite(parsed) || parsed < 0) return null
	return parsed
}

export function isTrackableRssStatus(status: number): boolean {
	return status === 200
}

export function isTrackableMediaStatus(status: number): boolean {
	return status === 200 || status === 206
}
