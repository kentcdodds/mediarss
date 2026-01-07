import * as jose from 'jose'
import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'

const KEY_ID = 'oauth-signing-key'

interface StoredKey {
	id: string
	public_key_jwk: string
	private_key_jwk: string
}

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

	// Store in database
	db.query(
		sql`INSERT OR REPLACE INTO oauth_signing_keys (id, public_key_jwk, private_key_jwk) VALUES (?, ?, ?);`,
	).run(KEY_ID, JSON.stringify(publicKeyJwk), JSON.stringify(privateKeyJwk))

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
	const row = db
		.query<StoredKey, [string]>(
			sql`SELECT * FROM oauth_signing_keys WHERE id = ?;`,
		)
		.get(KEY_ID)

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
