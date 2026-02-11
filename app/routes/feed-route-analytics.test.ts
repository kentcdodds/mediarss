import { expect, spyOn, test } from 'bun:test'
import '#app/config/init-env.ts'
import {
	createCuratedFeedToken,
	revokeCuratedFeedToken,
} from '#app/db/curated-feed-tokens.ts'
import {
	createDirectoryFeedToken,
	revokeDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import { compactCrossHeaderPrecedenceCases } from '#app/helpers/analytics-header-precedence-matrix.ts'
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

function readTwoLatestRssEvents(feedId: string): LatestRssEvent[] {
	return db
		.query<LatestRssEvent, [string]>(
			sql`
				SELECT feed_type, token, status_code, client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY rowid DESC
				LIMIT 2;
			`,
		)
		.all(feedId)
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
		client_name: 'Pocket Casts',
	})
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
			expect(await response.text()).toContain('<rss')
		})
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
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

test('feed route stores fallback client name for unknown user-agents', async () => {
	using ctx = createCuratedFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'CustomPodClient/1.2 (Linux)',
		}),
	)
	expect(response.status).toBe(200)

	expect(readLatestRssEvent(ctx.feed.id)?.client_name).toBe(
		'CustomPodClient/1.2',
	)
})

test('feed route does not log analytics for missing tokens', async () => {
	const missingToken = `missing-token-${Date.now()}`
	const response = await feedHandler.action(
		createFeedActionContext(missingToken),
	)

	expect(response.status).toBe(404)
	expect(countEventsForToken(missingToken)).toBe(0)
})

test('feed route does not log analytics for revoked curated tokens', async () => {
	using ctx = createCuratedFeedRouteTestContext()
	expect(revokeCuratedFeedToken(ctx.token)).toBe(true)

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(404)
	expect(countEventsForToken(ctx.token)).toBe(0)
})

test('feed route does not log analytics for revoked directory tokens', async () => {
	using ctx = createDirectoryFeedRouteTestContext()
	expect(revokeDirectoryFeedToken(ctx.token)).toBe(true)

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(404)
	expect(countEventsForToken(ctx.token)).toBe(0)
})

test('feed route touches curated token last_used_at on successful fetch', async () => {
	using ctx = createCuratedFeedRouteTestContext()

	const before = db
		.query<{ last_used_at: number | null }, [string]>(
			sql`
				SELECT last_used_at
				FROM curated_feed_tokens
				WHERE token = ?;
			`,
		)
		.get(ctx.token)
	expect(before?.last_used_at ?? null).toBeNull()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	const after = db
		.query<{ last_used_at: number | null }, [string]>(
			sql`
				SELECT last_used_at
				FROM curated_feed_tokens
				WHERE token = ?;
			`,
		)
		.get(ctx.token)
	expect((after?.last_used_at ?? 0) > 0).toBe(true)
})

test('feed route logs rss_fetch analytics for directory feeds', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'Overcast/1.0',
			'X-Forwarded-For': '203.0.113.98',
		}),
	)
	expect(response.status).toBe(200)

	const event = readLatestRssEvent(ctx.feed.id)
	expect(event).toMatchObject({
		feed_type: 'directory',
		token: ctx.token,
		status_code: 200,
		client_name: 'Overcast',
	})
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route touches directory token last_used_at on successful fetch', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const before = db
		.query<{ last_used_at: number | null }, [string]>(
			sql`
				SELECT last_used_at
				FROM directory_feed_tokens
				WHERE token = ?;
			`,
		)
		.get(ctx.token)
	expect(before?.last_used_at ?? null).toBeNull()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	const after = db
		.query<{ last_used_at: number | null }, [string]>(
			sql`
				SELECT last_used_at
				FROM directory_feed_tokens
				WHERE token = ?;
			`,
		)
		.get(ctx.token)
	expect((after?.last_used_at ?? 0) > 0).toBe(true)
})

test('feed route applies cross-header precedence cases consistently', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	for (const testCase of compactCrossHeaderPrecedenceCases) {
		const responseWithHeaderMatrix = await feedHandler.action(
			createFeedActionContext(ctx.token, testCase.headers),
		)
		expect(responseWithHeaderMatrix.status).toBe(200)

		const responseWithCanonicalIp = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': testCase.canonicalIp,
			}),
		)
		expect(responseWithCanonicalIp.status).toBe(200)

		const events = readTwoLatestRssEvents(ctx.feed.id)
		expect(events).toHaveLength(2)
		expect(events[0]?.client_name).toBeNull()
		expect(events[1]?.client_name).toBeNull()
		expect(events[0]?.client_fingerprint).toBeTruthy()
		expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
	}
})

test('feed route falls back to user-agent fingerprint when proxy IP headers are invalid', async () => {
	using ctx = createCuratedFeedRouteTestContext()
	const userAgent = 'CustomPodClient/1.2 (Linux)'

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown, nonsense',
			Forwarded: 'for=unknown;proto=https',
			'X-Real-IP': 'unknown',
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const canonicalResponse = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': userAgent,
		}),
	)
	expect(canonicalResponse.status).toBe(200)

	const events = readTwoLatestRssEvents(ctx.feed.id)
	expect(events).toHaveLength(2)
	expect(events[0]?.client_name).toBe('CustomPodClient/1.2')
	expect(events[1]?.client_name).toBe('CustomPodClient/1.2')
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})
