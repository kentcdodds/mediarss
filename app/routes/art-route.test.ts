import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import artHandler from './art.ts'

migrate(db)

type ArtActionContext = Parameters<typeof artHandler.action>[0]

function createArtRouteTestContext() {
	const feed = createDirectoryFeed({
		name: `art-route-test-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:test'],
	})
	const token = createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Art route token',
	})

	return {
		token: token.token,
		[Symbol.dispose]: () => {
			deleteDirectoryFeed(feed.id)
		},
	}
}

test('art route rejects malformed path encoding', async () => {
	using ctx = createArtRouteTestContext()
	const request = new Request(`http://localhost/art/${ctx.token}/%E0%A4%A`)
	const response = await artHandler.action({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: {
			token: ctx.token,
			path: '%E0%A4%A',
		},
	} as unknown as ArtActionContext)

	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')
})
