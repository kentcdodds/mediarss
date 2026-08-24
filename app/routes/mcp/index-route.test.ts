import {
	Client,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import routes from '#app/config/routes.ts'
import { deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { buildFeedRssPath, buildFeedRssUrl } from '#app/helpers/feed-url.ts'
import { generateAccessToken } from '#app/oauth/tokens.ts'
import router from '#app/router.tsx'
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

test('modern POST without MCP-Protocol-Version is rejected', async () => {
	const token = await issueAccessToken()
	const request = new Request('http://localhost/mcp', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			'Mcp-Method': 'tools/list',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/list',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientInfo': {
						name: 'header-test',
						version: '1.0.0',
					},
					'io.modelcontextprotocol/clientCapabilities': {},
				},
			},
		}),
	})

	const response = await handleMcp(request)
	const body = (await response.json()) as {
		error?: { code?: number; message?: string }
	}

	expect(response.status).toBe(400)
	expect(body.error?.code).toBe(-32020)
	expect(body.error?.message?.toLowerCase()).toMatch(
		/header|protocol-version|mismatch/,
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

test('legacy session DELETE is rejected', async () => {
	const token = await issueAccessToken()
	const response = await handleMcp(
		new Request('http://localhost/mcp', {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		}),
	)

	expect(response.status).toBe(405)
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

type CreateFeedToolResult = {
	success: boolean
	feed: { id: string; name: string }
	token: string
	rssUrl: string
}

type CreateTokenToolResult = {
	success: boolean
	feedId: string
	token: string
	label: string
	rssUrl: string
}

type GetTokensToolResult = {
	feedId: string
	feedName: string
	tokens: Array<{
		token: string
		label: string
		createdAt: number
		rssUrl: string
	}>
}

async function connectMcpClient() {
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
		{ name: 'mcp-feed-url-label-test', version: '1.0.0' },
		{ versionNegotiation: { mode: { pin: '2026-07-28' } } },
	)
	await client.connect(transport)
	return client
}

test('create_feed_token persists labels and returns /feed/{token} URLs', async () => {
	const client = await connectMcpClient()
	const feedName = `mcp-token-label-${Date.now()}-${Math.random().toString(36).slice(2)}`
	let feedId: string | undefined

	try {
		const createFeed = await client.callTool({
			name: 'create_curated_feed',
			arguments: { name: feedName },
		})
		expect(createFeed.isError).toBeFalsy()

		const createdFeed = createFeed.structuredContent as CreateFeedToolResult
		feedId = createdFeed.feed.id
		expect(createdFeed.rssUrl).toBe(
			buildFeedRssUrl('http://localhost', createdFeed.token),
		)
		expect(createdFeed.rssUrl).toBe(
			`http://localhost/feed/${createdFeed.token}`,
		)
		expect(createdFeed.rssUrl).not.toContain('?token=')
		expect(createdFeed.rssUrl).not.toContain(createdFeed.feed.id)

		const createToken = await client.callTool({
			name: 'create_feed_token',
			arguments: { feedId, label: 'Nathan' },
		})
		expect(createToken.isError).toBeFalsy()

		const createdToken = createToken.structuredContent as CreateTokenToolResult
		expect(createdToken.label).toBe('Nathan')
		expect(createdToken.rssUrl).toBe(
			buildFeedRssUrl('http://localhost', createdToken.token),
		)
		expect(createdToken.rssUrl).toMatch(/\/feed\/[^/?]+$/)
		expect(createdToken.rssUrl).not.toContain('?token=')
		expect(createdToken.rssUrl).not.toContain(feedId)

		expect(createToken.content[0]).toEqual({
			type: 'text',
			text: expect.stringContaining('Nathan'),
		})
		expect(createToken.content[0]).toEqual({
			type: 'text',
			text: expect.stringContaining(createdToken.rssUrl),
		})
		expect(createToken.content[0]).toEqual({
			type: 'text',
			text: expect.not.stringContaining('?token='),
		})

		const listTokens = await client.callTool({
			name: 'get_feed_tokens',
			arguments: { feedId },
		})
		expect(listTokens.isError).toBeFalsy()

		const listed = listTokens.structuredContent as GetTokensToolResult
		const defaultToken = listed.tokens.find(
			(token) => token.token === createdFeed.token,
		)
		expect(defaultToken?.label).toBe('Default')

		const nathan = listed.tokens.find(
			(token) => token.token === createdToken.token,
		)
		expect(nathan).toEqual({
			token: createdToken.token,
			label: 'Nathan',
			createdAt: expect.any(Number),
			rssUrl: createdToken.rssUrl,
		})

		expect(listTokens.content[0]).toEqual({
			type: 'text',
			text: expect.stringMatching(/Nathan[\s\S]*Default|Default[\s\S]*Nathan/),
		})
		expect(listTokens.content[0]).toEqual({
			type: 'text',
			text: expect.not.stringContaining('Unlabeled'),
		})
		expect(listTokens.content[0]).toEqual({
			type: 'text',
			text: expect.not.stringContaining('?token='),
		})

		const feedResponse = await router.fetch(
			new Request(`http://localhost${buildFeedRssPath(createdToken.token)}`),
		)
		expect(feedResponse.status).toBe(200)
		expect(feedResponse.headers.get('Content-Type')).toContain('xml')

		const brokenShape = await router.fetch(
			new Request(
				`http://localhost${routes.feed.href({ token: feedId })}?token=${createdToken.token}`,
			),
		)
		expect(brokenShape.status).toBe(404)
	} finally {
		await client.close()
		if (feedId) {
			await deleteCuratedFeed(feedId)
		}
	}
})
