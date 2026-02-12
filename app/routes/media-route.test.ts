import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import mediaHandlers from './media.ts'

type MediaActionContext = Parameters<typeof mediaHandlers.action>[0]
type MinimalMediaActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(
	context: MinimalMediaActionContext,
): MediaActionContext {
	return context as MediaActionContext
}

function createMediaActionContext(pathParam: string): MediaActionContext {
	const request = new Request(`http://localhost/media/token/${pathParam}`)
	return asActionContext({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: {
			token: 'test-token',
			path: pathParam,
		},
	})
}

test('media route returns 400 for malformed path encoding', async () => {
	const response = await mediaHandlers.action(
		createMediaActionContext('%E0%A4%A'),
	)
	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')
})
