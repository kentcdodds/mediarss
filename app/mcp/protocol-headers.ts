/**
 * 2026-07-28 Streamable HTTP header checks.
 * SDK 2.0.0 classifies modern-enveloped POSTs without MCP-Protocol-Version
 * as valid, so we enforce the required header before dispatch.
 */

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion'
const HEADER_MISMATCH_ERROR_CODE = -32020

function jsonRpcId(body: unknown): string | number | null {
	if (
		typeof body === 'object' &&
		body !== null &&
		'id' in body &&
		(typeof body.id === 'string' ||
			typeof body.id === 'number' ||
			body.id === null)
	) {
		return body.id
	}
	return null
}

function headerMismatchResponse(body: unknown, message: string): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			error: {
				code: HEADER_MISMATCH_ERROR_CODE,
				message,
			},
			id: jsonRpcId(body),
		}),
		{
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		},
	)
}

function modernProtocolVersion(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined
	if (!('params' in body) || typeof body.params !== 'object' || !body.params) {
		return undefined
	}

	const meta = (body.params as { _meta?: unknown })._meta
	if (typeof meta !== 'object' || meta === null) return undefined

	const version = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY]
	return typeof version === 'string' ? version : undefined
}

/**
 * Reject modern-enveloped POSTs that omit or disagree on MCP-Protocol-Version.
 * Returns null when the request is not a modern-enveloped POST.
 */
export function validateModernProtocolHeaders(
	request: Request,
	body: unknown,
): Response | null {
	if (request.method !== 'POST') return null

	const claimedVersion = modernProtocolVersion(body)
	if (!claimedVersion) return null

	const headerVersion = request.headers.get('mcp-protocol-version')
	if (!headerVersion) {
		return headerMismatchResponse(
			body,
			'HeaderMismatch: MCP-Protocol-Version is required on modern requests',
		)
	}

	if (headerVersion !== claimedVersion) {
		return headerMismatchResponse(
			body,
			`HeaderMismatch: MCP-Protocol-Version "${headerVersion}" does not match body "${claimedVersion}"`,
		)
	}

	return null
}
