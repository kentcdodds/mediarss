function normalizeClientIpToken(value: string): string | null {
	const trimmedValue = value.trim()
	if (!trimmedValue) return null

	const unquotedValue = trimmedValue.replace(/^"(.*)"$/, '$1').trim()
	if (!unquotedValue) return null

	let normalizedValue = unquotedValue

	if (normalizedValue.startsWith('[')) {
		const closingBracketIndex = normalizedValue.indexOf(']')
		if (closingBracketIndex <= 1) return null

		const suffix = normalizedValue.slice(closingBracketIndex + 1).trim()
		if (suffix && !/^:\d+$/.test(suffix)) return null

		normalizedValue = normalizedValue.slice(1, closingBracketIndex).trim()
		if (!normalizedValue) return null
	} else {
		const lastColonIndex = normalizedValue.lastIndexOf(':')
		const hasSingleColon =
			lastColonIndex > -1 && normalizedValue.indexOf(':') === lastColonIndex
		if (hasSingleColon) {
			const hostPart = normalizedValue.slice(0, lastColonIndex)
			const portPart = normalizedValue.slice(lastColonIndex + 1)
			if (hostPart.includes('.') && /^\d+$/.test(portPart)) {
				normalizedValue = hostPart
			}
		}
	}

	const normalizedLower = normalizedValue.toLowerCase()
	if (
		!normalizedValue ||
		normalizedLower === 'unknown' ||
		normalizedLower.startsWith('unknown:')
	) {
		return null
	}
	if (normalizedValue.startsWith('_')) return null

	return normalizedValue
}

function getForwardedHeaderCandidates(forwardedHeader: string): string[] {
	const candidates: string[] = []

	for (const segment of forwardedHeader.split(',')) {
		for (const parameter of segment.split(';')) {
			const equalsIndex = parameter.indexOf('=')
			if (equalsIndex === -1) continue

			const key = parameter.slice(0, equalsIndex).trim().toLowerCase()
			if (key !== 'for') continue

			const value = parameter.slice(equalsIndex + 1).trim()
			if (value) candidates.push(value)
		}
	}

	return candidates
}

/**
 * Parse the best-effort client IP from request headers.
 */
export function getClientIp(request: Request): string | null {
	const forwardedFor = request.headers.get('X-Forwarded-For')
	if (forwardedFor) {
		for (const candidate of forwardedFor.split(',')) {
			const normalizedCandidate = normalizeClientIpToken(candidate)
			if (normalizedCandidate) return normalizedCandidate
		}
	}

	const forwarded = request.headers.get('Forwarded')
	if (forwarded) {
		for (const candidate of getForwardedHeaderCandidates(forwarded)) {
			const normalizedCandidate = normalizeClientIpToken(candidate)
			if (normalizedCandidate) return normalizedCandidate
		}
	}

	const realIp = request.headers.get('X-Real-IP')
	const normalizedRealIp = realIp ? normalizeClientIpToken(realIp) : null
	if (normalizedRealIp) return normalizedRealIp

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
