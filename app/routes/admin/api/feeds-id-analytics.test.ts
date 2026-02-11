import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { createFeedAnalyticsEvent } from '#app/db/feed-analytics-events.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import analyticsHandler from './feeds.$id.analytics.ts'

migrate(db)

function createTestFeedContext() {
	const feed = createDirectoryFeed({
		name: `analytics-test-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:test'],
	})
	const token = createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Test Token',
	})

	return {
		feed,
		token,
		[Symbol.dispose]: () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteDirectoryFeed(feed.id)
		},
	}
}

type AnalyticsActionContext = Parameters<typeof analyticsHandler.action>[0]

function createActionContext(id: string, days = 30): AnalyticsActionContext {
	const request = new Request(
		`http://localhost/admin/api/feeds/${id}/analytics?days=${days}`,
	)

	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { id },
	} as unknown as AnalyticsActionContext
}

test('feed analytics endpoint returns summary, token breakdown, and top clients', () => {
	using ctx = createTestFeedContext()
	const now = Math.floor(Date.now() / 1000)

	createFeedAnalyticsEvent({
		eventType: 'rss_fetch',
		feedId: ctx.feed.id,
		feedType: 'directory',
		token: ctx.token.token,
		statusCode: 200,
		clientFingerprint: 'fp-1',
		clientName: 'Apple Podcasts',
		createdAt: now - 60,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feed.id,
		feedType: 'directory',
		token: ctx.token.token,
		mediaRoot: 'audio',
		relativePath: 'episode.mp3',
		isDownloadStart: true,
		bytesServed: 12345,
		statusCode: 200,
		clientFingerprint: 'fp-1',
		clientName: 'Apple Podcasts',
		createdAt: now - 30,
	})

	const response = analyticsHandler.action(createActionContext(ctx.feed.id))
	expect(response.status).toBe(200)

	return response.json().then((data) => {
		expect(data.feed.id).toBe(ctx.feed.id)
		expect(data.summary).toMatchObject({
			rssFetches: 1,
			mediaRequests: 1,
			downloadStarts: 1,
			bytesServed: 12345,
			uniqueClients: 1,
		})

		expect(data.byToken).toHaveLength(1)
		expect(data.byToken[0]).toMatchObject({
			token: ctx.token.token,
			label: 'Test Token',
			rssFetches: 1,
			mediaRequests: 1,
		})

		expect(data.topMediaItems).toHaveLength(1)
		expect(data.topMediaItems[0]).toMatchObject({
			mediaRoot: 'audio',
			relativePath: 'episode.mp3',
			mediaRequests: 1,
		})

		expect(data.topClients).toHaveLength(1)
		expect(data.topClients[0]).toMatchObject({
			clientName: 'Apple Podcasts',
			mediaRequests: 1,
			rssFetches: 1,
		})
	})
})

test('feed analytics endpoint clamps analytics window days to max', () => {
	using ctx = createTestFeedContext()
	const response = analyticsHandler.action(
		createActionContext(ctx.feed.id, 9999),
	)
	expect(response.status).toBe(200)

	return response.json().then((data) => {
		expect(data.windowDays).toBe(365)
	})
})
