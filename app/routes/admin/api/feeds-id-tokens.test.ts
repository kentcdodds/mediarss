import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import routes from '#app/config/routes.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { buildFeedRssPath } from '#app/helpers/feed-url.ts'
import router from '#app/router.tsx'

type CreatedToken = {
	token: string
	feedId: string
	label: string
}

type FeedDetailResponse = {
	tokens: Array<{ token: string; label: string }>
}

test('admin API stores a supplied token label and lists it on the feed', async () => {
	const feed = await createCuratedFeed({
		name: `admin-token-label-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	})

	try {
		const createResponse = await router.fetch(
			new Request(
				`http://localhost${routes.adminApiFeedTokens.href({ id: feed.id })}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ label: 'Nathan' }),
				},
			),
		)
		expect(createResponse.status).toBe(201)

		const created = (await createResponse.json()) as CreatedToken
		expect(created.label).toBe('Nathan')
		expect(created.feedId).toBe(feed.id)

		const detailResponse = await router.fetch(
			new Request(
				`http://localhost${routes.adminApiFeed.href({ id: feed.id })}`,
			),
		)
		expect(detailResponse.status).toBe(200)

		const detail = (await detailResponse.json()) as FeedDetailResponse
		expect(detail.tokens).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					token: created.token,
					label: 'Nathan',
				}),
			]),
		)

		const feedResponse = await router.fetch(
			new Request(`http://localhost${buildFeedRssPath(created.token)}`),
		)
		expect(feedResponse.status).toBe(200)
	} finally {
		await deleteCuratedFeed(feed.id)
	}
})
