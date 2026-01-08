/**
 * MCP Streamable HTTP transport for Bun.
 *
 * Re-exports the SDK's WebStandardStreamableHTTPServerTransport which uses
 * Web API Request/Response, making it compatible with Bun.
 */

export type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
export {
	type HandleRequestOptions,
	WebStandardStreamableHTTPServerTransport,
	type WebStandardStreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
