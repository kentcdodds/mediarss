import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import protectedResourceHandler from './oauth-protected-resource.ts'

type ProtectedResourceActionContext = Parameters<
	typeof protectedResourceHandler.handler
>[0]

type MinimalProtectedResourceActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(
	context: MinimalProtectedResourceActionContext,
): ProtectedResourceActionContext {
	return context as ProtectedResourceActionContext
}

test('oauth protected resource metadata uses forwarded https origin', async () => {
	const request = new Request(
		'http://mediarss.doddsfamily.us/.well-known/oauth-protected-resource/mcp',
		{
			headers: {
				Forwarded: 'for=198.51.100.5;host=mediarss.doddsfamily.us;proto=https',
			},
		},
	)
	const response = await protectedResourceHandler.handler(
		asActionContext({
			request,
			method: 'GET',
			url: new URL(request.url),
			params: {},
		}),
	)

	expect(response.status).toBe(200)

	const data = (await response.json()) as {
		resource: string
		authorization_servers: string[]
		scopes_supported: string[]
	}

	expect(data.resource).toBe('https://mediarss.doddsfamily.us/mcp')
	expect(data.authorization_servers).toEqual([
		'https://mediarss.doddsfamily.us',
	])
	expect(data.scopes_supported).toContain('mcp:read')
	expect(data.scopes_supported).toContain('mcp:write')
})
