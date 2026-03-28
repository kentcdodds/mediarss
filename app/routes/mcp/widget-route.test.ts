import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import widgetHandler from './widget.ts'

migrate(db)

type WidgetActionContext = Parameters<typeof widgetHandler.handler>[0]
type MinimalWidgetActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(
	context: MinimalWidgetActionContext,
): WidgetActionContext {
	return context as WidgetActionContext
}

async function createWidgetTestContext(): Promise<{
	token: string
	[Symbol.asyncDispose]: () => Promise<void>
}> {
	const feed = await createDirectoryFeed({
		name: `widget-route-test-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:test'],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Widget test token',
	})

	return {
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await deleteDirectoryFeed(feed.id)
		},
	}
}

test('mcp widget route rejects malformed path encoding', async () => {
	await using ctx = await createWidgetTestContext()
	const request = new Request(
		`http://localhost/mcp/widget/${ctx.token}/%E0%A4%A`,
	)
	const response = await widgetHandler.handler(
		asActionContext({
			request,
			method: 'GET',
			url: new URL(request.url),
			params: {
				token: ctx.token,
				path: '%E0%A4%A',
			},
		}),
	)

	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid URL encoding')
})
