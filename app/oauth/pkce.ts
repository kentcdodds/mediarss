/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 * Implements RFC 7636.
 */

/**
 * Verify a PKCE code verifier against a stored code challenge.
 * Only supports S256 method as per security best practices.
 */
export async function verifyCodeChallenge(
	codeVerifier: string,
	codeChallenge: string,
	codeChallengeMethod: string,
): Promise<boolean> {
	if (codeChallengeMethod !== 'S256') {
		// Only S256 is supported for security
		return false
	}

	const computed = await computeS256Challenge(codeVerifier)
	return computed === codeChallenge
}

/**
 * Compute the S256 code challenge from a code verifier.
 * S256: BASE64URL(SHA256(code_verifier))
 */
export async function computeS256Challenge(
	codeVerifier: string,
): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(codeVerifier)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = new Uint8Array(hashBuffer)
	return base64UrlEncode(hashArray)
}

/**
 * Encode bytes as base64url (no padding).
 */
function base64UrlEncode(bytes: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...bytes))
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Validate that a code verifier meets RFC 7636 requirements.
 * Must be 43-128 characters, using only [A-Z], [a-z], [0-9], "-", ".", "_", "~"
 */
export function isValidCodeVerifier(codeVerifier: string): boolean {
	if (codeVerifier.length < 43 || codeVerifier.length > 128) {
		return false
	}
	// RFC 7636: unreserved characters
	return /^[A-Za-z0-9\-._~]+$/.test(codeVerifier)
}

/**
 * Validate that a code challenge is properly formatted.
 * S256 challenges should be 43 characters (256 bits base64url encoded).
 */
export function isValidCodeChallenge(codeChallenge: string): boolean {
	// S256 produces 32 bytes = 43 base64url characters (no padding)
	if (codeChallenge.length !== 43) {
		return false
	}
	return /^[A-Za-z0-9\-_]+$/.test(codeChallenge)
}

/**
 * Generate a random code verifier for testing purposes.
 */
export function generateCodeVerifier(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return base64UrlEncode(bytes)
}
