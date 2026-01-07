import * as jose from 'jose'
import { getKeyId, getPrivateKey } from './keys.ts'

// Access tokens expire after 1 hour
const ACCESS_TOKEN_EXPIRY_SECONDS = 3600

// Single-user subject identifier
const SUBJECT = 'user'

// Audience for MCP resource server
const AUDIENCE = 'mcp-server'

export interface AccessTokenPayload {
	iss: string
	aud: string
	sub: string
	exp: number
	iat: number
	scope: string
}

/**
 * Generate a JWT access token.
 */
export async function generateAccessToken(params: {
	issuer: string
	scope: string
}): Promise<{ token: string; expiresIn: number }> {
	const privateKey = await getPrivateKey()
	const kid = await getKeyId()

	const now = Math.floor(Date.now() / 1000)
	const exp = now + ACCESS_TOKEN_EXPIRY_SECONDS

	const token = await new jose.SignJWT({
		scope: params.scope,
	})
		.setProtectedHeader({ alg: 'RS256', kid })
		.setIssuer(params.issuer)
		.setAudience(AUDIENCE)
		.setSubject(SUBJECT)
		.setIssuedAt(now)
		.setExpirationTime(exp)
		.sign(privateKey)

	return {
		token,
		expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
	}
}

/**
 * Verify a JWT access token and return its payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifyAccessToken(
	token: string,
	issuer: string,
): Promise<AccessTokenPayload | null> {
	try {
		const { publicKey } = await import('./keys.ts').then((m) =>
			m.getSigningKeyPair(),
		)
		const jwk = await jose.importJWK(publicKey, 'RS256')

		const { payload } = await jose.jwtVerify(token, jwk, {
			issuer,
			audience: AUDIENCE,
		})

		return {
			iss: payload.iss as string,
			aud: payload.aud as string,
			sub: payload.sub as string,
			exp: payload.exp as number,
			iat: payload.iat as number,
			scope: (payload.scope as string) ?? '',
		}
	} catch {
		return null
	}
}

/**
 * Get the configured audience for access tokens.
 */
export function getAudience(): string {
	return AUDIENCE
}

/**
 * Get the configured subject for the single user.
 */
export function getSubject(): string {
	return SUBJECT
}
