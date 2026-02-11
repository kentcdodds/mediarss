import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import feedHandler from './feed.ts'

migrate(db)

type FeedActionContext = Parameters<typeof feedHandler.action>[0]

function createFeedRouteTestContext() {
	const feed = createCuratedFeed({
		name: `feed-route-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		description: 'Feed route analytics test',
	})
	const token = createCuratedFeedToken({
		feedId: feed.id,
		label: 'Feed route token',
	})

	return {
		feed,
		token: token.token,
		[Symbol.dispose]: () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteCuratedFeed(feed.id)
		},
	}
}

function createFeedActionContext(token: string): FeedActionContext {
	const request = new Request(`http://localhost/feed/${token}`)
	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { token },
	} as unknown as FeedActionContext
}

test('feed route logs rss_fetch analytics for successful responses', async () => {
	using ctx = createFeedRouteTestContext()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('application/rss+xml')

	const event = db
		.query<
			{
				event_type: string
				feed_id: string
				feed_type: string
				token: string
				status_code: number
			},
			[string, string]
		>(
			sql`
				SELECT event_type, feed_id, feed_type, token, status_code
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = ?
				ORDER BY created_at DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id, 'rss_fetch')

	expect(event).toMatchObject({
		event_type: 'rss_fetch',
		feed_id: ctx.feed.id,
		feed_type: 'curated',
		token: ctx.token,
		status_code: 200,
	})
})

test('feed route does not log analytics for missing tokens', async () => {
	const missingToken = `missing-token-${Date.now()}`
	const response = await feedHandler.action(
		createFeedActionContext(missingToken),
	)

	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Feed not found')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE token = ?;
			`,
		)
		.get(missingToken)

	expect(events?.count ?? 0).toBe(0)
})
