/**
 * MCP Server setup.
 * Creates and configures an McpServer instance for the media server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AuthInfo, hasScope, type McpScope } from './auth.ts'
import { serverMetadata } from './metadata.ts'
import { initializePrompts } from './prompts.ts'
import { initializeResources } from './resources.ts'
import { initializeTools } from './tools.ts'

/**
 * Server context passed to tool/resource/prompt handlers.
 */
export interface McpContext {
	authInfo: AuthInfo
	server: McpServer
	/** Base URL of the server (for widget resources) */
	baseUrl: string
}

/**
 * Create a new MCP server instance.
 */
export function createMcpServer(): McpServer {
	const server = new McpServer(
		{
			name: serverMetadata.name,
			version: serverMetadata.version,
		},
		{
			capabilities: {
				tools: { listChanged: true },
				resources: { listChanged: true, subscribe: true },
				prompts: { listChanged: true },
				logging: {},
			},
			instructions: serverMetadata.instructions,
		},
	)

	return server
}

/**
 * Initialize the MCP server with tools, resources, and prompts.
 * Registration is based on the user's authorized scopes.
 *
 * @param server - The MCP server instance
 * @param authInfo - Authentication information for the user
 * @param baseUrl - Base URL of the server (for widget resources)
 */
export async function initializeMcpServer(
	server: McpServer,
	authInfo: AuthInfo,
	baseUrl: string,
): Promise<void> {
	await initializeTools(server, authInfo, baseUrl)
	await initializeResources(server, authInfo, baseUrl)
	await initializePrompts(server, authInfo)
}

/**
 * Helper to check if the auth info has a specific scope.
 */
export function checkScope(authInfo: AuthInfo, ...scopes: McpScope[]): boolean {
	return hasScope(authInfo, ...scopes)
}
