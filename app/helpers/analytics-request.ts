import { isIP } from 'node:net'

function normalizeIpv4MappedIpv6(value: string): string | null {
	const normalizedValue = value.toLowerCase()
	if (!normalizedValue.startsWith('::ffff:')) return null

	const tail = normalizedValue.slice('::ffff:'.length)
	if (!tail) return null

	if (tail.includes('.')) {
		const octets = tail.split('.')
		if (octets.length !== 4) return null

		const parsedOctets: number[] = []
		for (const octet of octets) {
			if (!/^\d{1,3}$/.test(octet)) return null
			const value = Number.parseInt(octet, 10)
			if (!Number.isInteger(value) || value < 0 || value > 255) return null
			parsedOctets.push(value)
		}

		return parsedOctets.join('.')
	}

	const hexParts = tail.split(':')
	if (
		hexParts.length !== 2 ||
		hexParts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
	) {
		return null
	}

	const high = Number.parseInt(hexParts[0]!, 16)
	const low = Number.parseInt(hexParts[1]!, 16)
	return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

function getQuotedInnerValue(value: string): string | null {
	const quotedMatch = value.match(/^"(.*)"$/)
	if (!quotedMatch) return null
	return quotedMatch[1]?.replace(/\\"/g, '"').trim() ?? null
}

function getPossiblyMalformedQuotedInnerValue(value: string): string | null {
	const quotedValue = getQuotedInnerValue(value)
	if (quotedValue !== null) return quotedValue
	if (!value.startsWith('"')) return null
	return value.slice(1).replace(/\\"/g, '"').trim()
}

function hasUnclosedQuotes(value: string): boolean {
	let inQuotes = false

	for (let i = 0; i < value.length; i++) {
		const character = value[i]
		const isEscapedQuote = character === '"' && i > 0 && value[i - 1] === '\\'
		if (character === '"' && !isEscapedQuote) {
			inQuotes = !inQuotes
		}
	}

	return inQuotes
}

function stripDanglingBoundaryQuotes(value: string): string {
	let normalizedValue = value.trim()

	while (normalizedValue) {
		const hasDanglingEscapedLeadingQuote =
			normalizedValue.startsWith('\\"') && !normalizedValue.endsWith('"')
		if (hasDanglingEscapedLeadingQuote) {
			normalizedValue = normalizedValue.slice(2).trim()
			continue
		}

		const hasDanglingLeadingQuote =
			normalizedValue.startsWith('"') && !normalizedValue.endsWith('"')
		if (hasDanglingLeadingQuote) {
			normalizedValue = normalizedValue.slice(1).trim()
			continue
		}

		const hasDanglingEscapedTrailingQuote =
			normalizedValue.endsWith('\\"') && !normalizedValue.startsWith('"')
		if (hasDanglingEscapedTrailingQuote) {
			normalizedValue = normalizedValue.slice(0, -2).trim()
			continue
		}

		const hasDanglingTrailingQuote =
			normalizedValue.endsWith('"') && !normalizedValue.startsWith('"')
		if (hasDanglingTrailingQuote) {
			normalizedValue = normalizedValue.slice(0, -1).trim()
			continue
		}

		break
	}

	return normalizedValue
}

function normalizeClientIpToken(value: string): string | null {
	const trimmedValue = value.trim()
	if (!trimmedValue) return null

	const unquotedValue = getQuotedInnerValue(trimmedValue) ?? trimmedValue
	const normalizedUnquotedValue = stripDanglingBoundaryQuotes(unquotedValue)
	if (!normalizedUnquotedValue) return null

	let normalizedValue = normalizedUnquotedValue

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
	if (/["\s,;]/.test(normalizedValue)) return null
	if (normalizedValue.startsWith('_')) return null
	const ipVersion = isIP(normalizedValue)
	if (ipVersion === 0) return null

	if (ipVersion === 6) {
		try {
			const canonicalHostname = new URL(`http://[${normalizedValue}]/`).hostname
			const canonicalIpv6 = canonicalHostname.slice(1, -1)
			const mappedIpv4 = normalizeIpv4MappedIpv6(canonicalIpv6)
			if (mappedIpv4) return mappedIpv4
			return canonicalIpv6
		} catch {
			return normalizedValue.toLowerCase()
		}
	}

	return normalizedValue
}

function splitHeaderValues(
	headerValue: string,
	separator: ',' | ';',
): string[] {
	const tokens: string[] = []
	let currentToken = ''
	let inQuotes = false

	for (let i = 0; i < headerValue.length; i++) {
		const character = headerValue[i]
		const isEscapedQuote =
			character === '"' && i > 0 && headerValue[i - 1] === '\\'
		if (character === '"' && !isEscapedQuote) {
			inQuotes = !inQuotes
			currentToken += character
			continue
		}
		if (character === separator && !inQuotes) {
			const trimmedToken = currentToken.trim()
			if (trimmedToken) tokens.push(trimmedToken)
			currentToken = ''
			continue
		}
		currentToken += character
	}

	const trimmedToken = currentToken.trim()
	if (trimmedToken) tokens.push(trimmedToken)

	if (!inQuotes) return tokens

	return headerValue
		.split(separator)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
}

function splitCommaSeparatedHeaderValues(headerValue: string): string[] {
	return splitHeaderValues(headerValue, ',')
}

function splitSemicolonSeparatedHeaderValues(headerValue: string): string[] {
	return splitHeaderValues(headerValue, ';')
}

function getIpHeaderCandidates(headerValue: string): string[] {
	const candidates: string[] = []

	for (const rawCandidate of splitCommaSeparatedHeaderValues(headerValue)) {
		const quotedValue = getPossiblyMalformedQuotedInnerValue(rawCandidate)
		if (quotedValue?.includes(',')) {
			for (const nestedCandidate of splitCommaSeparatedHeaderValues(
				quotedValue,
			)) {
				const trimmedNestedCandidate = nestedCandidate.trim()
				if (trimmedNestedCandidate) candidates.push(trimmedNestedCandidate)
			}
			continue
		}

		candidates.push(quotedValue ?? rawCandidate)
	}

	return candidates
}

function getForwardedHeaderCandidates(forwardedHeader: string): string[] {
	const candidates: string[] = []
	const forwardedSegments: string[] = []

	const normalizeForwardedCandidate = (candidate: string): string => {
		let trimmedCandidate = candidate.trim()

		const unquotedCandidate =
			getPossiblyMalformedQuotedInnerValue(trimmedCandidate)
		if (unquotedCandidate !== null) {
			trimmedCandidate = unquotedCandidate
		}

		trimmedCandidate = stripDanglingBoundaryQuotes(trimmedCandidate)
		const equalsIndex = trimmedCandidate.indexOf('=')
		if (equalsIndex === -1) return trimmedCandidate

		const key = trimmedCandidate.slice(0, equalsIndex).trim().toLowerCase()
		if (key !== 'for') return trimmedCandidate

		let normalizedForValue = stripDanglingBoundaryQuotes(
			trimmedCandidate.slice(equalsIndex + 1).trim(),
		)
		const parameterDelimiterIndex = normalizedForValue.indexOf(';')
		if (parameterDelimiterIndex !== -1) {
			normalizedForValue = normalizedForValue
				.slice(0, parameterDelimiterIndex)
				.trim()
		}

		return stripDanglingBoundaryQuotes(normalizedForValue)
	}

	for (const rawSegment of splitCommaSeparatedHeaderValues(forwardedHeader)) {
		const segmentHasForParameter = splitSemicolonSeparatedHeaderValues(
			rawSegment,
		).some((parameter) => {
			const equalsIndex = parameter.indexOf('=')
			if (equalsIndex === -1) return false
			return parameter.slice(0, equalsIndex).trim().toLowerCase() === 'for'
		})
		const hasForwardedParameter = rawSegment.includes('=')
		const previousSegment = forwardedSegments.at(-1)
		const previousSegmentHasQuotedForParameter = previousSegment
			? splitSemicolonSeparatedHeaderValues(previousSegment).some(
					(parameter) => {
						const equalsIndex = parameter.indexOf('=')
						if (equalsIndex === -1) return false

						const key = parameter.slice(0, equalsIndex).trim().toLowerCase()
						if (key !== 'for') return false

						const value = parameter.slice(equalsIndex + 1).trim()
						return value.includes('"')
					},
				)
			: false
		const shouldMergeWithPreviousSegment =
			previousSegment &&
			(!hasForwardedParameter ||
				(!segmentHasForParameter &&
					(hasUnclosedQuotes(previousSegment) ||
						previousSegmentHasQuotedForParameter)))
		if (shouldMergeWithPreviousSegment) {
			const previousSegmentIndex = forwardedSegments.length - 1
			forwardedSegments[previousSegmentIndex] =
				`${previousSegment}, ${rawSegment}`
			continue
		}

		forwardedSegments.push(rawSegment)
	}

	for (const segment of forwardedSegments) {
		for (const parameter of splitSemicolonSeparatedHeaderValues(segment)) {
			const equalsIndex = parameter.indexOf('=')
			if (equalsIndex === -1) continue

			const key = parameter.slice(0, equalsIndex).trim().toLowerCase()
			if (key !== 'for') continue

			const value = parameter.slice(equalsIndex + 1).trim()
			if (!value) continue

			const quotedValue = getPossiblyMalformedQuotedInnerValue(value)
			if (quotedValue?.includes(',')) {
				for (const nestedCandidate of splitCommaSeparatedHeaderValues(
					quotedValue,
				)) {
					const trimmedNestedCandidate =
						normalizeForwardedCandidate(nestedCandidate)
					if (trimmedNestedCandidate) candidates.push(trimmedNestedCandidate)
				}
				continue
			}

			candidates.push(normalizeForwardedCandidate(quotedValue ?? value))
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
		for (const candidate of getIpHeaderCandidates(forwardedFor)) {
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
	if (realIp) {
		for (const candidate of getIpHeaderCandidates(realIp)) {
			const normalizedCandidate = normalizeClientIpToken(candidate)
			if (normalizedCandidate) return normalizedCandidate
		}
	}

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
