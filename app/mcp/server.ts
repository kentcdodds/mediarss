/**
 * MCP Server setup.
 * Creates and configures an McpServer instance for the media server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AuthInfo, hasScope, type McpScope } from './auth.ts'
import { initializePrompts } from './prompts.ts'
import { initializeResources } from './resources.ts'
import { initializeTools } from './tools.ts'

/**
 * Server context passed to tool/resource/prompt handlers.
 */
export interface McpContext {
	authInfo: AuthInfo
	server: McpServer
}

/**
 * Create a new MCP server instance.
 */
export function createMcpServer(): McpServer {
	const server = new McpServer(
		{
			name: 'media-server',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: { listChanged: true },
				resources: { listChanged: true, subscribe: true },
				prompts: { listChanged: true },
				logging: {},
			},
			instructions: `
This is a media server MCP that allows you to manage podcasts, audiobooks,
and video content. You can browse media directories, manage podcast/media feeds,
and organize your media library.

Available capabilities depend on your authorization scopes:
- mcp:read - Browse media, list feeds, view feed details
- mcp:write - Create feeds, modify feed settings, manage media assignments
			`.trim(),
		},
	)

	return server
}

/**
 * Initialize the MCP server with tools, resources, and prompts.
 * Registration is based on the user's authorized scopes.
 */
export async function initializeMcpServer(
	server: McpServer,
	authInfo: AuthInfo,
): Promise<void> {
	await initializeTools(server, authInfo)
	await initializeResources(server, authInfo)
	await initializePrompts(server, authInfo)
}

/**
 * Helper to check if the auth info has a specific scope.
 */
export function checkScope(authInfo: AuthInfo, ...scopes: McpScope[]): boolean {
	return hasScope(authInfo, ...scopes)
}
