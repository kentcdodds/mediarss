import { expect, test } from 'vitest'
import { sql } from 'remix/data-table'
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
import { selectOne } from '#app/db/rows.ts'
import { migrateDatabase } from '#app/db/migrate.ts'
import { spyOn } from '#test/bun-test-compat.ts'
import feedHandler from './feed.ts'

await migrateDatabase(db)

type FeedActionContext = Parameters<typeof feedHandler.handler>[0]
type MinimalFeedActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

type LatestRssEvent = {
	feed_type: string
	token: string
	status_code: number
	client_name: string | null
	client_fingerprint: string | null
}

function asActionContext(context: MinimalFeedActionContext): FeedActionContext {
	return context as FeedActionContext
}

type FeedRouteTestContext = {
	feed: { id: string }
	token: string
	[Symbol.asyncDispose]: () => Promise<void>
}

async function createCuratedFeedRouteTestContext(): Promise<FeedRouteTestContext> {
	const feed = await createCuratedFeed({
		name: `feed-route-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		description: 'Feed route analytics test',
	})
	const token = await createCuratedFeedToken({
		feedId: feed.id,
		label: 'Feed route token',
	})

	return {
		feed,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await db.exec(
				sql`DELETE FROM feed_analytics_events WHERE feed_id = ${feed.id};`,
			)
			await deleteCuratedFeed(feed.id)
		},
	}
}

async function createDirectoryFeedRouteTestContext(): Promise<FeedRouteTestContext> {
	const feed = await createDirectoryFeed({
		name: `directory-feed-route-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['missing-root'],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Directory feed route token',
	})

	return {
		feed,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await db.exec(
				sql`DELETE FROM feed_analytics_events WHERE feed_id = ${feed.id};`,
			)
			await deleteDirectoryFeed(feed.id)
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
	return asActionContext({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { token },
	})
}

async function readLatestRssEvent(
	feedId: string,
): Promise<LatestRssEvent | null> {
	return (
		(await selectOne<LatestRssEvent>(
			db,
			sql`
				SELECT feed_type, token, status_code, client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ${feedId} AND event_type = 'rss_fetch'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)) ?? null
	)
}

async function countEventsForToken(token: string): Promise<number> {
	const row = await selectOne<{ count: number }>(
		db,
		sql`
			SELECT COUNT(*) AS count
			FROM feed_analytics_events
			WHERE token = ${token};
		`,
	)
	return row?.count ?? 0
}

async function getCuratedTokenLastUsedAt(
	token: string,
): Promise<number | null> {
	const row = await selectOne<{ last_used_at: number | null }>(
		db,
		sql`
			SELECT last_used_at
			FROM curated_feed_tokens
			WHERE token = ${token};
		`,
	)
	return row?.last_used_at ?? null
}

async function getDirectoryTokenLastUsedAt(
	token: string,
): Promise<number | null> {
	const row = await selectOne<{ last_used_at: number | null }>(
		db,
		sql`
			SELECT last_used_at
			FROM directory_feed_tokens
			WHERE token = ${token};
		`,
	)
	return row?.last_used_at ?? null
}

async function withAnalyticsTableUnavailable(
	run: () => Promise<void>,
): Promise<void> {
	const backupTableName = `feed_analytics_events_backup_${Date.now()}_${Math.random()
		.toString(36)
		.slice(2)}`
	await db.exec(
		`ALTER TABLE feed_analytics_events RENAME TO ${backupTableName};`,
	)
	await using _restoreAnalyticsTable = {
		[Symbol.asyncDispose]: async () => {
			await db.exec(
				`ALTER TABLE ${backupTableName} RENAME TO feed_analytics_events;`,
			)
		},
	}
	await run()
}

test('feed route logs rss_fetch analytics for successful responses', async () => {
	await using ctx = await createCuratedFeedRouteTestContext()
	const response = await feedHandler.handler(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'Pocket Casts/7.0',
			'X-Forwarded-For': '203.0.113.25',
		}),
	)
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('application/rss+xml')

	const event = await readLatestRssEvent(ctx.feed.id)
	expect(event).toMatchObject({
		feed_type: 'curated',
		token: ctx.token,
		status_code: 200,
	})
	expect(event?.client_name).not.toBeNull()
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route still returns rss when analytics writes fail', async () => {
	await using ctx = await createCuratedFeedRouteTestContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	using _restoreConsoleErrorSpy = {
		[Symbol.dispose]: () => {
			consoleErrorSpy.mockRestore()
		},
	}

	await withAnalyticsTableUnavailable(async () => {
		const response = await feedHandler.handler(
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
	expect(await countEventsForToken(ctx.token)).toBe(0)
})

test('feed route stores null client metadata when request lacks client traits', async () => {
	await using ctx = await createCuratedFeedRouteTestContext()
	const response = await feedHandler.handler(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	expect(await readLatestRssEvent(ctx.feed.id)).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('feed route does not log analytics for missing tokens', async () => {
	const missingToken = `missing-token-${Date.now()}`
	const response = await feedHandler.handler(
		createFeedActionContext(missingToken),
	)

	expect(response.status).toBe(404)
	expect(await countEventsForToken(missingToken)).toBe(0)
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
		await using ctx = await testCase.createContext()
		expect(await testCase.revokeToken(ctx.token)).toBe(true)

		const response = await feedHandler.handler(
			createFeedActionContext(ctx.token),
		)
		expect(response.status).toBe(404)
		expect(await countEventsForToken(ctx.token)).toBe(0)
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
		await using ctx = await testCase.createContext()
		expect(await testCase.getLastUsedAt(ctx.token)).toBeNull()

		const response = await feedHandler.handler(
			createFeedActionContext(ctx.token),
		)
		expect(response.status).toBe(200)
		expect(((await testCase.getLastUsedAt(ctx.token)) ?? 0) > 0).toBe(true)

		const event = await readLatestRssEvent(ctx.feed.id)
		expect(event).toMatchObject({
			feed_type: testCase.expectedFeedType,
			token: ctx.token,
			status_code: 200,
		})
	}
})
