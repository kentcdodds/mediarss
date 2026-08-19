import {
	Client,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { generateAccessToken } from '#app/oauth/tokens.ts'
import mcpHandler from './index.ts'

migrate(db)

type McpActionContext = Parameters<typeof mcpHandler.handler>[0]

type MinimalMcpActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(context: MinimalMcpActionContext): McpActionContext {
	return context as McpActionContext
}

async function handleMcp(request: Request): Promise<Response> {
	return mcpHandler.handler(
		asActionContext({
			request,
			method: request.method,
			url: new URL(request.url),
			params: {},
		}),
	)
}

async function issueAccessToken(issuer = 'http://localhost'): Promise<string> {
	const { token } = await generateAccessToken({
		issuer,
		scope: 'mcp:read mcp:write',
	})
	return token
}

test('unauthenticated MCP request returns 401 with resource metadata', async () => {
	const request = new Request('http://localhost/mcp', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'server/discover',
		}),
	})

	const response = await handleMcp(request)
	const header = response.headers.get('WWW-Authenticate')

	expect(response.status).toBe(401)
	expect(header).toContain(
		'resource_metadata=http://localhost/.well-known/oauth-protected-resource/mcp',
	)
})

test('MCP CORS preflight advertises 2026-07-28 routing headers', async () => {
	const request = new Request('http://localhost/mcp', {
		method: 'OPTIONS',
	})

	const response = await handleMcp(request)

	expect(response.status).toBe(204)
	expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
		'GET, POST, OPTIONS',
	)
	expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
		'MCP-Protocol-Version',
	)
	expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
		'Mcp-Method',
	)
	expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
		'Mcp-Name',
	)
	expect(response.headers.get('Access-Control-Allow-Headers')).not.toContain(
		'mcp-session-id',
	)
})

test('legacy initialize handshake is rejected', async () => {
	const token = await issueAccessToken()
	const request = new Request('http://localhost/mcp', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-11-25',
				capabilities: {},
				clientInfo: { name: 'legacy-test', version: '1.0.0' },
			},
		}),
	})

	const response = await handleMcp(request)
	const body = (await response.json()) as {
		error?: { code?: number; message?: string }
	}

	expect(response.status).toBeGreaterThanOrEqual(400)
	expect(body.error?.code).toBe(-32022)
	expect(body.error?.message?.toLowerCase()).toContain('protocol')
})

test('modern MCP client can discover the server and list tools', async () => {
	const token = await issueAccessToken()
	const transport = new StreamableHTTPClientTransport(
		new URL('http://localhost/mcp'),
		{
			authProvider: {
				async token() {
					return token
				},
			},
			fetch(url, init) {
				return handleMcp(new Request(url, init))
			},
		},
	)
	const client = new Client(
		{ name: 'mcp-spec-upgrade-test', version: '1.0.0' },
		{ versionNegotiation: { mode: { pin: '2026-07-28' } } },
	)

	await client.connect(transport)
	try {
		const { tools } = await client.listTools()
		const toolNames = tools.map((tool) => tool.name)

		expect(toolNames).toContain('list_feeds')
		expect(toolNames).toContain('create_directory_feed')

		const result = await client.callTool({ name: 'list_feeds' })
		expect(result.isError).toBeFalsy()
		expect(result.content[0]).toMatchObject({ type: 'text' })
	} finally {
		await client.close()
	}
})
