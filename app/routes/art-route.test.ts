import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { getPodcastArtPlaceholderBytes } from '#app/helpers/podcast-art-placeholder.ts'
import artHandler from './art.ts'

migrate(db)

type ArtActionContext = Parameters<typeof artHandler.handler>[0]
type MinimalArtActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(context: MinimalArtActionContext): ArtActionContext {
	return context as ArtActionContext
}

async function createArtRouteTestContext(): Promise<{
	token: string
	[Symbol.asyncDispose]: () => Promise<void>
}> {
	const feed = await createDirectoryFeed({
		name: `art-route-test-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:test'],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Art route token',
	})

	return {
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await deleteDirectoryFeed(feed.id)
		},
	}
}

test('art route rejects malformed path encoding', async () => {
	await using ctx = await createArtRouteTestContext()
	const request = new Request(`http://localhost/art/${ctx.token}/%E0%A4%A`)
	const response = await artHandler.handler(
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
	expect(await response.text()).toBe('Invalid path encoding')
})

test('art route serves PNG placeholder for feed artwork when no artwork exists', async () => {
	const feed = await createCuratedFeed({
		name: `art-route-placeholder-${Date.now()}`,
		imageUrl: null,
	})
	const token = await createCuratedFeedToken({
		feedId: feed.id,
		label: 'Placeholder art token',
	})

	try {
		const request = new Request(`http://localhost/art/${token.token}/feed`)
		const response = await artHandler.handler(
			asActionContext({
				request,
				method: 'GET',
				url: new URL(request.url),
				params: {
					token: token.token,
					path: 'feed',
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('image/png')
		const body = Buffer.from(await response.arrayBuffer())
		expect(body.equals(getPodcastArtPlaceholderBytes())).toBe(true)
	} finally {
		await deleteCuratedFeed(feed.id)
	}
})
