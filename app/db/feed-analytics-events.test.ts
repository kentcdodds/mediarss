import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import '#app/config/init-env.ts'
import {
	createFeedAnalyticsEvent,
	getFeedAnalyticsByToken,
	getFeedAnalyticsSummary,
	getFeedDailyAnalytics,
	getFeedTopClientAnalytics,
	getFeedTopMediaItemAnalytics,
	getMediaAnalyticsByFeed,
	getMediaAnalyticsByToken,
	getMediaAnalyticsSummary,
	getMediaTopClientAnalytics,
	pruneFeedAnalyticsEvents,
} from './feed-analytics-events.ts'
import { migrate } from './migrations.ts'

function createTestDatabase() {
	const dbPath = `./data/test-feed-analytics-events-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
	const dir = path.dirname(dbPath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}

	const database = new Database(dbPath)
	migrate(database)

	return {
		database,
		[Symbol.dispose]: () => {
			database.close()
			if (fs.existsSync(dbPath)) {
				fs.unlinkSync(dbPath)
			}
		},
	}
}

test('feed analytics aggregate correctly by summary/token/day/top-items', () => {
	using ctx = createTestDatabase()
	const { database } = ctx
	const base = 1_700_000_000
	const day = 86_400

	createFeedAnalyticsEvent(
		{
			eventType: 'rss_fetch',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			statusCode: 200,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'rss_fetch',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			statusCode: 200,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base + 60,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			mediaRoot: 'audio',
			relativePath: 'book-one.mp3',
			isDownloadStart: true,
			bytesServed: 1000,
			statusCode: 200,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base + 120,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			mediaRoot: 'audio',
			relativePath: 'book-one.mp3',
			isDownloadStart: false,
			bytesServed: 500,
			statusCode: 206,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base + 180,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-b',
			mediaRoot: 'audio',
			relativePath: 'book-two.mp3',
			isDownloadStart: true,
			bytesServed: 2000,
			statusCode: 200,
			clientFingerprint: 'fp-2',
			clientName: 'Pocket Casts',
			createdAt: base + day + 60,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-b',
			mediaRoot: 'audio',
			relativePath: 'book-one.mp3',
			isDownloadStart: true,
			bytesServed: 1500,
			statusCode: 200,
			clientFingerprint: 'fp-3',
			clientName: 'Overcast',
			createdAt: base + day + 120,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-2',
			feedType: 'curated',
			token: 'token-x',
			mediaRoot: 'audio',
			relativePath: 'book-one.mp3',
			isDownloadStart: true,
			bytesServed: 700,
			statusCode: 200,
			clientFingerprint: 'fp-4',
			clientName: 'Overcast',
			createdAt: base + day + 200,
		},
		database,
	)

	const summary = getFeedAnalyticsSummary('feed-1', base, database)
	expect(summary).toEqual({
		rssFetches: 2,
		mediaRequests: 4,
		downloadStarts: 3,
		bytesServed: 5000,
		uniqueClients: 3,
	})

	const byToken = getFeedAnalyticsByToken('feed-1', base, database)
	expect(byToken).toHaveLength(2)
	expect(byToken[0]).toMatchObject({
		token: 'token-b',
		rssFetches: 0,
		mediaRequests: 2,
		downloadStarts: 2,
		bytesServed: 3500,
		uniqueClients: 2,
	})
	expect(byToken[1]).toMatchObject({
		token: 'token-a',
		rssFetches: 2,
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1500,
		uniqueClients: 1,
	})

	const topItems = getFeedTopMediaItemAnalytics('feed-1', base, 10, database)
	expect(topItems).toHaveLength(2)
	expect(topItems[0]).toMatchObject({
		mediaRoot: 'audio',
		relativePath: 'book-one.mp3',
		mediaRequests: 3,
		downloadStarts: 2,
		bytesServed: 3000,
		uniqueClients: 2,
	})
	expect(topItems[1]).toMatchObject({
		mediaRoot: 'audio',
		relativePath: 'book-two.mp3',
		mediaRequests: 1,
		downloadStarts: 1,
		bytesServed: 2000,
		uniqueClients: 1,
	})

	const daily = getFeedDailyAnalytics('feed-1', base, database)
	expect(daily).toHaveLength(2)
	expect(daily[0]).toMatchObject({
		rssFetches: 2,
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1500,
		uniqueClients: 1,
	})
	expect(daily[1]).toMatchObject({
		rssFetches: 0,
		mediaRequests: 2,
		downloadStarts: 2,
		bytesServed: 3500,
		uniqueClients: 2,
	})

	const topClients = getFeedTopClientAnalytics('feed-1', base, 10, database)
	expect(topClients).toHaveLength(3)
	expect(topClients[0]).toMatchObject({
		clientName: 'Apple Podcasts',
		rssFetches: 2,
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1500,
		uniqueClients: 1,
	})
	expect(topClients.map((client) => client.clientName)).toEqual(
		expect.arrayContaining(['Pocket Casts', 'Overcast']),
	)
})

test('media analytics aggregate across feeds/tokens and normalize paths', () => {
	using ctx = createTestDatabase()
	const { database } = ctx
	const base = 1_700_100_000

	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			mediaRoot: 'audio',
			relativePath: 'series\\book.mp3',
			isDownloadStart: true,
			bytesServed: 1000,
			statusCode: 200,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			mediaRoot: 'audio',
			relativePath: 'series/book.mp3',
			isDownloadStart: false,
			bytesServed: 500,
			statusCode: 206,
			clientFingerprint: 'fp-1',
			clientName: 'Apple Podcasts',
			createdAt: base + 60,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-b',
			mediaRoot: 'audio',
			relativePath: 'series/book.mp3',
			isDownloadStart: true,
			bytesServed: 800,
			statusCode: 200,
			clientFingerprint: 'fp-2',
			clientName: 'Pocket Casts',
			createdAt: base + 120,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-2',
			feedType: 'curated',
			token: 'token-x',
			mediaRoot: 'audio',
			relativePath: 'series/book.mp3',
			isDownloadStart: true,
			bytesServed: 700,
			statusCode: 200,
			clientFingerprint: 'fp-3',
			clientName: 'Overcast',
			createdAt: base + 180,
		},
		database,
	)

	const summary = getMediaAnalyticsSummary(
		'audio',
		'series/book.mp3',
		base - 1,
		database,
	)
	expect(summary).toEqual({
		rssFetches: 0,
		mediaRequests: 4,
		downloadStarts: 3,
		bytesServed: 3000,
		uniqueClients: 3,
	})

	const byFeed = getMediaAnalyticsByFeed(
		'audio',
		'series/book.mp3',
		base - 1,
		database,
	)
	expect(byFeed).toHaveLength(2)
	expect(byFeed[0]).toMatchObject({
		feedId: 'feed-1',
		feedType: 'directory',
		mediaRequests: 3,
		downloadStarts: 2,
		bytesServed: 2300,
		uniqueClients: 2,
	})
	expect(byFeed[1]).toMatchObject({
		feedId: 'feed-2',
		feedType: 'curated',
		mediaRequests: 1,
		downloadStarts: 1,
		bytesServed: 700,
		uniqueClients: 1,
	})

	const byToken = getMediaAnalyticsByToken(
		'audio',
		'series/book.mp3',
		base - 1,
		database,
	)
	expect(byToken).toHaveLength(3)
	expect(byToken[0]).toMatchObject({
		token: 'token-a',
		feedId: 'feed-1',
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1500,
		uniqueClients: 1,
	})

	const topClients = getMediaTopClientAnalytics(
		'audio',
		'series/book.mp3',
		base - 1,
		10,
		database,
	)
	expect(topClients).toHaveLength(3)
	expect(topClients[0]).toMatchObject({
		clientName: 'Apple Podcasts',
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1500,
		uniqueClients: 1,
	})
	expect(topClients.map((client) => client.clientName)).toEqual(
		expect.arrayContaining(['Pocket Casts', 'Overcast']),
	)
})

test('pruneFeedAnalyticsEvents removes older analytics rows', () => {
	using ctx = createTestDatabase()
	const { database } = ctx
	const base = 1_700_200_000

	createFeedAnalyticsEvent(
		{
			eventType: 'rss_fetch',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			statusCode: 200,
			clientFingerprint: 'fp-1',
			createdAt: base - 1_000,
		},
		database,
	)
	createFeedAnalyticsEvent(
		{
			eventType: 'media_request',
			feedId: 'feed-1',
			feedType: 'directory',
			token: 'token-a',
			mediaRoot: 'audio',
			relativePath: 'book.mp3',
			isDownloadStart: true,
			bytesServed: 2500,
			statusCode: 200,
			clientFingerprint: 'fp-1',
			createdAt: base + 100,
		},
		database,
	)

	const deleted = pruneFeedAnalyticsEvents(base, database)
	expect(deleted).toBe(1)

	const summary = getFeedAnalyticsSummary('feed-1', base - 2_000, database)
	expect(summary).toEqual({
		rssFetches: 0,
		mediaRequests: 1,
		downloadStarts: 1,
		bytesServed: 2500,
		uniqueClients: 1,
	})
})
