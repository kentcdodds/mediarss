/**
 * Generate a UUIDv7 identifier.
 * UUIDv7 is time-sortable and uses the current timestamp plus random bits.
 * Bun's crypto.randomUUID() generates UUIDv4, so we implement UUIDv7 manually.
 */
export function generateId(): string {
	const timestamp = Date.now()

	// Get random bytes for the rest
	const randomBytes = new Uint8Array(10)
	crypto.getRandomValues(randomBytes)

	// UUIDv7 format: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
	// First 48 bits: timestamp in milliseconds
	// Next 4 bits: version (7)
	// Next 12 bits: random
	// Next 2 bits: variant (10)
	// Last 62 bits: random

	const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')

	// Timestamp (48 bits = 12 hex chars)
	const timestampHex = hex(timestamp, 12)

	// Random bits with version and variant
	const randA = ((randomBytes[0]! & 0x0f) | 0x70).toString(16) // version 7
	const randB = hex(randomBytes[1]!, 2)
	const randC = hex(randomBytes[2]!, 2)
	const randD = ((randomBytes[3]! & 0x3f) | 0x80).toString(16) // variant 10
	const randE = hex(randomBytes[4]!, 2)
	const randF = hex(randomBytes[5]!, 2)
	const randG = hex(randomBytes[6]!, 2)
	const randH = hex(randomBytes[7]!, 2)
	const randI = hex(randomBytes[8]!, 2)
	const randJ = hex(randomBytes[9]!, 2)

	return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-${randA}${randB}${randC.slice(0, 1)}-${randD}${randE}${randC.slice(1)}-${randF}${randG}${randH}${randI}${randJ}`
}

/**
 * Generate a secure random token for feed access URLs.
 * Returns a URL-safe base64-encoded string of 32 random bytes.
 */
export function generateToken(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)

	// Convert to base64url (URL-safe base64)
	const base64 = btoa(String.fromCharCode(...bytes))
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
