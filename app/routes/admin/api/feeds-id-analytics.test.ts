import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
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

function createCuratedTestFeedContext() {
	const feed = createCuratedFeed({
		name: `analytics-curated-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		description: 'Test curated feed',
	})
	const token = createCuratedFeedToken({
		feedId: feed.id,
		label: 'Curated Token',
	})

	return {
		feed,
		token,
		[Symbol.dispose]: () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteCuratedFeed(feed.id)
		},
	}
}

type AnalyticsActionContext = Parameters<typeof analyticsHandler.action>[0]

function createActionContext(
	id: string,
	days: number | string = 30,
): AnalyticsActionContext {
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
	const deletedToken = `deleted-token-${Date.now()}`

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
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feed.id,
		feedType: 'directory',
		token: deletedToken,
		mediaRoot: 'audio',
		relativePath: 'episode.mp3',
		isDownloadStart: true,
		bytesServed: 2000,
		statusCode: 200,
		clientFingerprint: 'fp-2',
		clientName: 'Overcast',
		createdAt: now - 20,
	})

	const response = analyticsHandler.action(createActionContext(ctx.feed.id))
	expect(response.status).toBe(200)

	return response.json().then((data) => {
		expect(data.feed.id).toBe(ctx.feed.id)
		expect(data.summary).toMatchObject({
			rssFetches: 1,
			mediaRequests: 2,
			downloadStarts: 2,
			bytesServed: 14345,
			uniqueClients: 2,
		})

		expect(data.byToken).toHaveLength(2)

		const knownToken = data.byToken.find(
			(row: { token: string }) => row.token === ctx.token.token,
		)
		expect(knownToken).toMatchObject({
			label: 'Test Token',
			rssFetches: 1,
			mediaRequests: 1,
		})
		expect(knownToken.createdAt).not.toBeNull()

		const deletedTokenRow = data.byToken.find(
			(row: { token: string }) => row.token === deletedToken,
		)
		expect(deletedTokenRow).toMatchObject({
			token: deletedToken,
			label: 'Deleted token',
			createdAt: null,
			mediaRequests: 1,
			downloadStarts: 1,
			bytesServed: 2000,
		})

		expect(data.topMediaItems).toHaveLength(1)
		expect(data.topMediaItems[0]).toMatchObject({
			mediaRoot: 'audio',
			relativePath: 'episode.mp3',
			mediaRequests: 2,
		})

		expect(data.topClients).toHaveLength(2)
		expect(
			data.topClients.some(
				(client: { clientName: string; mediaRequests: number }) =>
					client.clientName === 'Apple Podcasts' && client.mediaRequests === 1,
			),
		).toBe(true)
		expect(
			data.topClients.some(
				(client: { clientName: string; mediaRequests: number }) =>
					client.clientName === 'Overcast' && client.mediaRequests === 1,
			),
		).toBe(true)
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

test('feed analytics endpoint defaults analytics window for invalid values', () => {
	using ctx = createTestFeedContext()

	const invalidTextResponse = analyticsHandler.action(
		createActionContext(ctx.feed.id, 'abc'),
	)
	expect(invalidTextResponse.status).toBe(200)

	const negativeResponse = analyticsHandler.action(
		createActionContext(ctx.feed.id, -5),
	)
	expect(negativeResponse.status).toBe(200)

	return Promise.all([
		invalidTextResponse.json(),
		negativeResponse.json(),
	]).then(([invalidTextData, negativeData]) => {
		expect(invalidTextData.windowDays).toBe(30)
		expect(negativeData.windowDays).toBe(30)
	})
})

test('feed analytics endpoint supports curated feeds', () => {
	using ctx = createCuratedTestFeedContext()
	const now = Math.floor(Date.now() / 1000)
	const deletedToken = `curated-deleted-token-${Date.now()}`

	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feed.id,
		feedType: 'curated',
		token: ctx.token.token,
		mediaRoot: 'audio',
		relativePath: 'curated-episode.mp3',
		isDownloadStart: true,
		bytesServed: 4200,
		statusCode: 200,
		clientFingerprint: 'curated-fp',
		clientName: 'Overcast',
		createdAt: now - 30,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feed.id,
		feedType: 'curated',
		token: deletedToken,
		mediaRoot: 'audio',
		relativePath: 'curated-episode.mp3',
		isDownloadStart: false,
		bytesServed: 800,
		statusCode: 206,
		clientFingerprint: 'curated-fp-2',
		clientName: 'Downcast',
		createdAt: now - 20,
	})

	const response = analyticsHandler.action(createActionContext(ctx.feed.id))
	expect(response.status).toBe(200)

	return response.json().then((data) => {
		expect(data.feed).toMatchObject({
			id: ctx.feed.id,
			name: ctx.feed.name,
			type: 'curated',
		})
		expect(data.summary).toMatchObject({
			mediaRequests: 2,
			downloadStarts: 1,
			bytesServed: 5000,
		})
		expect(data.byToken).toHaveLength(2)
		const knownToken = data.byToken.find(
			(row: { token: string }) => row.token === ctx.token.token,
		)
		expect(knownToken).toMatchObject({
			token: ctx.token.token,
			label: 'Curated Token',
		})
		const deletedTokenRow = data.byToken.find(
			(row: { token: string }) => row.token === deletedToken,
		)
		expect(deletedTokenRow).toMatchObject({
			token: deletedToken,
			label: 'Deleted token',
			createdAt: null,
			mediaRequests: 1,
			downloadStarts: 0,
			bytesServed: 800,
		})
	})
})

test('feed analytics endpoint returns not found for unknown feed id', async () => {
	const response = await analyticsHandler.action(
		createActionContext('missing-feed-id'),
	)
	expect(response.status).toBe(404)
	expect(await response.json()).toEqual({ error: 'Feed not found' })
})
