import { expect, spyOn, test } from 'bun:test'
import '#app/config/init-env.ts'
import {
	createCuratedFeedToken,
	revokeCuratedFeedToken,
} from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import {
	createDirectoryFeedToken,
	revokeDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import feedHandler from './feed.ts'

migrate(db)

type FeedActionContext = Parameters<typeof feedHandler.action>[0]

type LatestRssEvent = {
	feed_type: string
	token: string
	status_code: number
	client_name: string | null
	client_fingerprint: string | null
}

function createCuratedFeedRouteTestContext() {
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

function createDirectoryFeedRouteTestContext() {
	const feed = createDirectoryFeed({
		name: `directory-feed-route-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['missing-root'],
	})
	const token = createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Directory feed route token',
	})

	return {
		feed,
		token: token.token,
		[Symbol.dispose]: () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteDirectoryFeed(feed.id)
		},
	}
}

function createFeedActionContext(
	token: string,
	headers: Record<string, string> = {},
): FeedActionContext {
	const request = new Request(`http://localhost/feed/${token}`, {
		headers,
	})
	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { token },
	} as unknown as FeedActionContext
}

function readLatestRssEvent(feedId: string): LatestRssEvent | null {
	return db
		.query<LatestRssEvent, [string]>(
			sql`
				SELECT feed_type, token, status_code, client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.get(feedId)
}

function countEventsForToken(token: string): number {
	return (
		db
			.query<{ count: number }, [string]>(
				sql`
					SELECT COUNT(*) AS count
					FROM feed_analytics_events
					WHERE token = ?;
				`,
			)
			.get(token)?.count ?? 0
	)
}

function getCuratedTokenLastUsedAt(token: string): number | null {
	return (
		db
			.query<{ last_used_at: number | null }, [string]>(
				sql`
					SELECT last_used_at
					FROM curated_feed_tokens
					WHERE token = ?;
				`,
			)
			.get(token)?.last_used_at ?? null
	)
}

function getDirectoryTokenLastUsedAt(token: string): number | null {
	return (
		db
			.query<{ last_used_at: number | null }, [string]>(
				sql`
					SELECT last_used_at
					FROM directory_feed_tokens
					WHERE token = ?;
				`,
			)
			.get(token)?.last_used_at ?? null
	)
}

async function withAnalyticsTableUnavailable(
	run: () => Promise<void>,
): Promise<void> {
	const backupTableName = `feed_analytics_events_backup_${Date.now()}_${Math.random()
		.toString(36)
		.slice(2)}`
	db.exec(`ALTER TABLE feed_analytics_events RENAME TO ${backupTableName};`)
	try {
		await run()
	} finally {
		db.exec(`ALTER TABLE ${backupTableName} RENAME TO feed_analytics_events;`)
	}
}

test('feed route logs rss_fetch analytics for successful responses', async () => {
	using ctx = createCuratedFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'Pocket Casts/7.0',
			'X-Forwarded-For': '203.0.113.25',
		}),
	)
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('application/rss+xml')

	const event = readLatestRssEvent(ctx.feed.id)
	expect(event).toMatchObject({
		feed_type: 'curated',
		token: ctx.token,
		status_code: 200,
	})
	expect(event?.client_name).not.toBeNull()
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route still returns rss when analytics writes fail', async () => {
	using ctx = createCuratedFeedRouteTestContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	try {
		await withAnalyticsTableUnavailable(async () => {
			const response = await feedHandler.action(
				createFeedActionContext(ctx.token, {
					'User-Agent': 'Pocket Casts/7.0',
					'X-Forwarded-For': '203.0.113.25',
				}),
			)
			expect(response.status).toBe(200)
			expect(response.headers.get('Content-Type')).toContain(
				'application/rss+xml',
			)
		})
	} finally {
		consoleErrorSpy.mockRestore()
	}

	expect(countEventsForToken(ctx.token)).toBe(0)
})

test('feed route stores null client metadata when request lacks client traits', async () => {
	using ctx = createCuratedFeedRouteTestContext()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	expect(readLatestRssEvent(ctx.feed.id)).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('feed route does not log analytics for missing tokens', async () => {
	const missingToken = `missing-token-${Date.now()}`
	const response = await feedHandler.action(
		createFeedActionContext(missingToken),
	)

	expect(response.status).toBe(404)
	expect(countEventsForToken(missingToken)).toBe(0)
})

test('feed route does not log analytics for revoked tokens', async () => {
	const cases = [
		{
			createContext: createCuratedFeedRouteTestContext,
			revokeToken: revokeCuratedFeedToken,
		},
		{
			createContext: createDirectoryFeedRouteTestContext,
			revokeToken: revokeDirectoryFeedToken,
		},
	] as const

	for (const testCase of cases) {
		using ctx = testCase.createContext()
		expect(testCase.revokeToken(ctx.token)).toBe(true)

		const response = await feedHandler.action(
			createFeedActionContext(ctx.token),
		)
		expect(response.status).toBe(404)
		expect(countEventsForToken(ctx.token)).toBe(0)
	}
})

test('feed route touches token last_used_at on successful fetch', async () => {
	const cases = [
		{
			createContext: createCuratedFeedRouteTestContext,
			getLastUsedAt: getCuratedTokenLastUsedAt,
			expectedFeedType: 'curated',
		},
		{
			createContext: createDirectoryFeedRouteTestContext,
			getLastUsedAt: getDirectoryTokenLastUsedAt,
			expectedFeedType: 'directory',
		},
	] as const

	for (const testCase of cases) {
		using ctx = testCase.createContext()
		expect(testCase.getLastUsedAt(ctx.token)).toBeNull()

		const response = await feedHandler.action(
			createFeedActionContext(ctx.token),
		)
		expect(response.status).toBe(200)
		expect((testCase.getLastUsedAt(ctx.token) ?? 0) > 0).toBe(true)

		const event = readLatestRssEvent(ctx.feed.id)
		expect(event).toMatchObject({
			feed_type: testCase.expectedFeedType,
			token: ctx.token,
			status_code: 200,
		})
	}
})
