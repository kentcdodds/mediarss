import { type ClientMetadataDocument } from './client-metadata.ts'

/**
 * Pinned Client ID Metadata Documents for first-party MCP clients.
 * Used when the authorization server cannot reach the client_id URL
 * (common on NAS hosts with broken or filtered egress).
 *
 * Update this pin when Kody rotates redirect URIs or grant types.
 */
export const KODY_CIMD_URL = 'https://kody.codes/oauth/client-metadata.json'

const KODY_CIMD_DOCUMENT: ClientMetadataDocument = {
	client_id: KODY_CIMD_URL,
	client_name: 'Kody',
	redirect_uris: ['https://kody.codes/account/mcp-servers/oauth/callback'],
	grant_types: ['authorization_code', 'refresh_token'],
	response_types: ['code'],
	token_endpoint_auth_method: 'none',
}

const KNOWN_CIMD_DOCUMENTS: Readonly<Record<string, ClientMetadataDocument>> = {
	[KODY_CIMD_URL]: KODY_CIMD_DOCUMENT,
}

export function getKnownClientMetadata(
	clientId: string,
): ClientMetadataDocument | null {
	return KNOWN_CIMD_DOCUMENTS[clientId] ?? null
}

export function listKnownClientMetadataUrls(): Array<string> {
	return Object.keys(KNOWN_CIMD_DOCUMENTS)
}
