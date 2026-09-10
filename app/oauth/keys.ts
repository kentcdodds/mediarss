import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { oauthSigningKeysTable } from '#app/db/schema.ts'

const KEY_ID = 'oauth-signing-key'

// CryptoKey is the runtime type for jose key operations
type SigningKey = CryptoKey

let cachedKeyPair: {
	publicKey: jose.JWK
	privateKey: SigningKey
	kid: string
} | null = null

/**
 * Generate a new RS256 keypair and store it in the database.
 */
async function generateAndStoreKeyPair(): Promise<{
	publicKey: jose.JWK
	privateKey: SigningKey
	kid: string
}> {
	const { publicKey, privateKey } = await jose.generateKeyPair('RS256', {
		extractable: true,
	})

	const publicKeyJwk = await jose.exportJWK(publicKey)
	const privateKeyJwk = await jose.exportJWK(privateKey)

	// Add key ID to public key
	publicKeyJwk.kid = KEY_ID
	publicKeyJwk.use = 'sig'
	publicKeyJwk.alg = 'RS256'

	await db.query(oauthSigningKeysTable).upsert({
		id: KEY_ID,
		public_key_jwk: JSON.stringify(publicKeyJwk),
		private_key_jwk: JSON.stringify(privateKeyJwk),
		created_at: Math.floor(Date.now() / 1000),
	})

	return {
		publicKey: publicKeyJwk,
		privateKey: privateKey as SigningKey,
		kid: KEY_ID,
	}
}

/**
 * Load the keypair from the database.
 */
async function loadKeyPair(): Promise<{
	publicKey: jose.JWK
	privateKey: SigningKey
	kid: string
} | null> {
	const row = await db.find(oauthSigningKeysTable, KEY_ID)

	if (!row) {
		return null
	}

	const publicKeyJwk = JSON.parse(row.public_key_jwk) as jose.JWK
	const privateKeyJwk = JSON.parse(row.private_key_jwk) as jose.JWK
	const privateKey = (await jose.importJWK(
		privateKeyJwk,
		'RS256',
	)) as SigningKey

	return {
		publicKey: publicKeyJwk,
		privateKey,
		kid: KEY_ID,
	}
}

/**
 * Get the signing keypair, generating one if it doesn't exist.
 * This function caches the keypair in memory for performance.
 */
export async function getSigningKeyPair(): Promise<{
	publicKey: jose.JWK
	privateKey: SigningKey
	kid: string
}> {
	if (cachedKeyPair) {
		return cachedKeyPair
	}

	let keyPair = await loadKeyPair()
	if (!keyPair) {
		keyPair = await generateAndStoreKeyPair()
	}

	cachedKeyPair = keyPair
	return keyPair
}

/**
 * Get the public key in JWK format for the JWKS endpoint.
 */
export async function getPublicKeyJwk(): Promise<jose.JWK> {
	const { publicKey } = await getSigningKeyPair()
	return publicKey
}

/**
 * Get the private key for signing tokens.
 */
export async function getPrivateKey(): Promise<SigningKey> {
	const { privateKey } = await getSigningKeyPair()
	return privateKey
}

/**
 * Get the key ID for the current signing key.
 */
export async function getKeyId(): Promise<string> {
	const { kid } = await getSigningKeyPair()
	return kid
}

/**
 * Clear the cached keypair (useful for testing).
 */
export function clearKeyCache(): void {
	cachedKeyPair = null
}

/**
 * Initialize the signing keypair at startup.
 * This prevents race conditions when multiple concurrent requests
 * arrive before any key exists - without this, multiple keys could
 * be generated and tokens signed with overwritten keys would fail verification.
 */
export async function ensureSigningKey(): Promise<void> {
	await getSigningKeyPair()
}
