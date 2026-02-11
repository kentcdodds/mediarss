import { expect, test } from 'bun:test'
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
import {
	getClientFingerprint,
	getClientIp,
} from '#app/helpers/analytics-request.ts'
import {
	crossHeaderForwardedValues,
	crossHeaderXForwardedForValues,
	crossHeaderXRealIpValues,
	repeatedForwardedForHeaderBuilders,
	repeatedForwardedForValues,
	repeatedForwardedTripleForHeaderBuilders,
	repeatedForwardedTripleForValues,
} from '#app/helpers/analytics-header-precedence-matrix.ts'
import feedHandler from './feed.ts'

migrate(db)

type FeedActionContext = Parameters<typeof feedHandler.action>[0]

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

	const event = db
		.query<
			{
				event_type: string
				feed_id: string
				feed_type: string
				token: string
				status_code: number
				client_name: string | null
				client_fingerprint: string | null
			},
			[string, string]
		>(
			sql`
				SELECT event_type, feed_id, feed_type, token, status_code, client_name, client_fingerprint
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
		client_name: 'Pocket Casts',
	})
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route stores null client metadata when request lacks client traits', async () => {
	using ctx = createCuratedFeedRouteTestContext()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
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

test('feed route does not log analytics for revoked tokens', async () => {
	using ctx = createCuratedFeedRouteTestContext()
	expect(revokeCuratedFeedToken(ctx.token)).toBe(true)

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
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
		.get(ctx.token)

	expect(events?.count ?? 0).toBe(0)
})

test('feed route touches token last_used_at on successful fetch', async () => {
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

	const event = db
		.query<
			{
				feed_type: string
				token: string
				status_code: number
				client_name: string | null
			},
			[string]
		>(
			sql`
				SELECT feed_type, token, status_code, client_name
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		feed_type: 'directory',
		token: ctx.token,
		status_code: 200,
		client_name: 'Overcast',
	})
})

test('feed route stores null client metadata for directory requests without traits', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('feed route records fallback client name for unknown user-agents', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'CustomPodClient/1.2 (Linux)',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event?.client_name).toBe('CustomPodClient/1.2')
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route fingerprints requests with X-Real-IP and no user-agent', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.19',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event?.client_name).toBeNull()
	expect(event?.client_fingerprint).toBeTruthy()
})

test('feed route normalizes X-Real-IP values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRealIpPort = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.148:8443',
		}),
	)
	expect(responseWithRealIpPort.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.148',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes bracketed IPv6 X-Real-IP values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithBracketedIpv6RealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '[2001:db8:cafe::61]:8443',
		}),
	)
	expect(responseWithBracketedIpv6RealIp.status).toBe(200)

	const responseWithEquivalentIpv6RealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '2001:db8:cafe::61',
		}),
	)
	expect(responseWithEquivalentIpv6RealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes quoted X-Real-IP values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithQuotedRealIpPort = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '"198.51.100.151:8443"',
		}),
	)
	expect(responseWithQuotedRealIpPort.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.151',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route uses first valid value from comma-separated X-Real-IP header', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRealIpChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': 'unknown, "198.51.100.155:8443", 198.51.100.156',
		}),
	)
	expect(responseWithRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.155',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route preserves first valid X-Real-IP candidate across trailing segment noise matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const trailingSegments = [
		'nonsense',
		'unknown',
		'_hidden',
		'"unknown"',
		'"\\"unknown\\", 198.51.100.228"',
		'198.51.100.229:8080',
		'[2001:db8::9b]:443',
	]

	const realIpHeaders = trailingSegments.map(
		(trailingSegment) => `198.51.100.226,${trailingSegment},198.51.100.227`,
	)

	for (const realIp of realIpHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': realIp,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '198.51.100.226',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(realIpHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route parses quoted whole-chain X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithQuotedRealIpChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '"unknown, 198.51.100.161:8443"',
		}),
	)
	expect(responseWithQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.161',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling trailing quotes in X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingTrailingQuoteRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '198.51.100.255"',
		}),
	)
	expect(responseWithDanglingTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.255',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling trailing quotes in X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingTrailingQuoteRealIp =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '198.51.100.246""',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.246',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling leading quotes in X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingLeadingQuoteRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"198.51.100.241',
		}),
	)
	expect(responseWithDanglingLeadingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.241',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling leading quotes in X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingLeadingQuoteRealIp =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '""198.51.100.244',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.244',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses escaped-quote whole-chain X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithEscapedQuotedRealIpChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"\\"unknown\\", 198.51.100.226:8443"',
		}),
	)
	expect(responseWithEscapedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.226',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers from malformed quoted whole-chain X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedQuotedRealIpChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"unknown, 198.51.100.218:8443, 198.51.100.219',
		}),
	)
	expect(responseWithMalformedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.218',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers from malformed escaped-quote whole-chain X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedEscapedQuotedRealIpChain =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '"\\"unknown\\", 198.51.100.246:8443',
			}),
		)
	expect(responseWithMalformedEscapedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.246',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers escaped-quote chains with repeated trailing quotes in X-Real-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithEscapedChainRepeatedTrailingQuoteRealIp =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '"\\"unknown\\", 198.51.100.245\\"\\"',
			}),
		)
	expect(responseWithEscapedChainRepeatedTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.245',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route stores null fingerprint for all-invalid comma-separated X-Real-IP header', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': 'unknown, proxy.internal, "198.51.100.159:abc"',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('feed route stores null fingerprint when proxy IP headers are invalid', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const response = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			Forwarded: 'for=unknown',
			'X-Real-IP': '_hidden',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('feed route falls back to user-agent fingerprint when proxy IP headers are invalid', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithInvalidIpHeaders = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			Forwarded: 'for=unknown',
			'X-Real-IP': '_hidden',
			'User-Agent': 'Pocket Casts/7.0',
		}),
	)
	expect(responseWithInvalidIpHeaders.status).toBe(200)

	const responseWithUserAgentOnly = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'User-Agent': 'Pocket Casts/7.0',
		}),
	)
	expect(responseWithUserAgentOnly.status).toBe(200)

	const events = db
		.query<
			{
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY rowid DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_name).toBe('Pocket Casts')
	expect(events[1]?.client_name).toBe('Pocket Casts')
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route uses Forwarded header when X-Forwarded-For is missing', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=203.0.113.61;proto=https',
		}),
	)
	expect(responseWithForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.61',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses quoted whole-chain Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, 203.0.113.207";proto=https',
		}),
	)
	expect(responseWithQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.207',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling trailing quotes in Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingTrailingQuoteForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=198.51.100.240";proto=https',
		}),
	)
	expect(responseWithDanglingTrailingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.240',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling trailing quotes in Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingTrailingQuoteForwarded =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for=198.51.100.247"";proto=https',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.247',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling leading quotes in Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingLeadingQuoteForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="198.51.100.242;proto=https',
		}),
	)
	expect(responseWithDanglingLeadingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.242',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling leading quotes in Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingLeadingQuoteForwarded =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for=""198.51.100.243;proto=https',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.243',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses escaped-quote whole-chain Forwarded for values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithEscapedQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="\\"unknown\\", 198.51.100.227:8443";proto=https',
		}),
	)
	expect(responseWithEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.227',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers from malformed quoted Forwarded chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, 203.0.113.215, for=198.51.100.215;proto=https',
		}),
	)
	expect(responseWithMalformedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.215',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers malformed Forwarded quoted for chains split before proto segment', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedSplitForwardedChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="""unknown", 198.51.100.253;proto=https',
		}),
	)
	expect(responseWithMalformedSplitForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.253',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers malformed Forwarded quoted for chains split without whitespace before proto segment', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedSplitForwardedChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="""unknown",198.51.100.239;proto=https',
		}),
	)
	expect(responseWithMalformedSplitForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.239',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls through malformed Forwarded first segment to later valid for candidate', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedThenValidForwardedChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="""unknown",proto=https,for=198.51.100.240;proto=https',
		}),
	)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.240',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls through nested invalid forwarded for token to later valid candidate', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedThenValidForwardedChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded:
				'for="unknown, for=unknown";proto=https,for=198.51.100.230;proto=https',
		}),
	)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.230',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls through deeply nested obfuscated forwarded for token to later valid candidate', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedThenValidForwardedChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded:
				'for="unknown, for=for=for=_hidden";proto=https,for=198.51.100.252;proto=https',
		}),
	)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.252',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers nested forwarded for tokens inside quoted for chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedForwardedForToken = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, for=198.51.100.233";proto=https',
		}),
	)
	expect(responseWithNestedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.233',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers quoted nested forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedQuotedForwardedForToken = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, "for=198.51.100.226"";proto=https',
		}),
	)
	expect(responseWithNestedQuotedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.226',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers nested uppercase forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseForwardedForToken = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, FOR = 198.51.100.232";proto=https',
		}),
	)
	expect(responseWithNestedUppercaseForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.232',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers nested forwarded ipv6 tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6ForwardedForToken = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, for=[2001:DB8::a]:443";proto=https',
		}),
	)
	expect(responseWithNestedIpv6ForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::a',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers nested forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=198.51.100.229;proto=https";proto=https',
			}),
		)
	expect(responseWithNestedParameterizedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.229',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6ParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=[2001:db8::c]:443;proto=https";proto=https',
			}),
		)
	expect(responseWithNestedIpv6ParameterizedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::c',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedDoublePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=for=198.51.100.244";proto=https',
			}),
		)
	expect(responseWithNestedDoublePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.244',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested forwarded ipv6 tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6DoublePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=for=[2001:db8::d]:443";proto=https',
			}),
		)
	expect(responseWithNestedIpv6DoublePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::d',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedDoublePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=for=198.51.100.249;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.249',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6DoublePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=for=[2001:db8::12]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6DoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::12',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers triply-prefixed nested forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedTriplePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=for=for=198.51.100.234";proto=https',
			}),
		)
	expect(responseWithNestedTriplePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.234',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers triply-prefixed nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6TriplePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=for=for=[2001:db8::18]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::18',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers triply-prefixed nested uppercase forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseTriplePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, FOR=FOR=FOR=198.51.100.239";proto=https',
			}),
		)
	expect(responseWithNestedUppercaseTriplePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.239',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers triply-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseIpv6TriplePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR=FOR=FOR=[2001:db8::23]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::23',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers quadruply-prefixed nested forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedQuadruplePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=for=for=for=198.51.100.242";proto=https',
			}),
		)
	expect(responseWithNestedQuadruplePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.242',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers quadruply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6QuadrupleMixedCasePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = [2001:db8::26]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6QuadrupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::26',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers quintuply-prefixed mixed-case nested forwarded tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedQuintupleMixedCasePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = FOR = 198.51.100.247;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedQuintupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.247',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers quintuply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedIpv6QuintupleMixedCasePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = FOR = [2001:db8::29]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6QuintupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::29',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested ipv4-mapped forwarded ipv6 tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedMappedIpv6DoublePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, for=for=[::FFFF:C633:64A0]:443";proto=https',
			}),
		)
	expect(responseWithNestedMappedIpv6DoublePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.160',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed mixed-case nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedMappedIpv6MixedCaseDoublePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR = FOR = [::ffff:c633:64a1]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedMappedIpv6MixedCaseDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.161',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers triply-prefixed nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedMappedIpv6TriplePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=for=for=[::FFFF:C633:64A2]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedMappedIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.162',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes nested dotted mapped forwarded ipv6 prefix matrix inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forms = ['for=', 'for =', 'FOR=', 'FOR =']
	const wrappers = [
		(candidate: string) => `for="unknown, ${candidate}";proto=https`,
		(candidate: string) =>
			`for="unknown, ${candidate};proto=https";proto=https`,
	]
	const mappedIpv6 = '[::ffff:198.51.100.181]:443'

	const buildNestedPrefixes = (
		depth: number,
		accumulatedPrefixes: string[] = [],
	): string[][] => {
		if (depth === 0) return [accumulatedPrefixes]
		const combinations: string[][] = []
		for (const form of forms) {
			combinations.push(
				...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
			)
		}
		return combinations
	}

	const forwardedHeaders: string[] = []
	for (const depth of [1, 2]) {
		for (const prefixCombination of buildNestedPrefixes(depth)) {
			const candidate = `${prefixCombination.join('')}${mappedIpv6}`
			for (const wrapCandidate of wrappers) {
				forwardedHeaders.push(wrapCandidate(candidate))
			}
		}
	}

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.181',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route normalizes nested hexadecimal mapped forwarded ipv6 prefix matrix inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forms = ['for=', 'for =', 'FOR=', 'FOR =']
	const wrappers = [
		(candidate: string) => `for="unknown, ${candidate}";proto=https`,
		(candidate: string) =>
			`for="unknown, ${candidate};proto=https";proto=https`,
	]
	const mappedIpv6 = '[::ffff:c633:64b8]:443'

	const buildNestedPrefixes = (
		depth: number,
		accumulatedPrefixes: string[] = [],
	): string[][] => {
		if (depth === 0) return [accumulatedPrefixes]
		const combinations: string[][] = []
		for (const form of forms) {
			combinations.push(
				...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
			)
		}
		return combinations
	}

	const forwardedHeaders: string[] = []
	for (const depth of [1, 2]) {
		for (const prefixCombination of buildNestedPrefixes(depth)) {
			const candidate = `${prefixCombination.join('')}${mappedIpv6}`
			for (const wrapCandidate of wrappers) {
				forwardedHeaders.push(wrapCandidate(candidate))
			}
		}
	}

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.184',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route falls through deeply nested invalid forwarded for token to later valid candidate', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedInvalidThenValidForwardedChain =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, for=for=for=unknown";proto=https,for=198.51.100.248;proto=https',
			}),
		)
	expect(responseWithNestedInvalidThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.248',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested uppercase forwarded for tokens inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseDoublePrefixForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="unknown, FOR=FOR=198.51.100.254";proto=https',
			}),
		)
	expect(responseWithNestedUppercaseDoublePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.254',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested uppercase forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseDoublePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR=FOR=198.51.100.253;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.253',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers doubly-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithNestedUppercaseIpv6DoublePrefixParameterizedForwardedForToken =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded:
					'for="unknown, FOR=FOR=[2001:db8::15]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseIpv6DoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8::15',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers malformed Forwarded proto tail segments', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedForwardedProtoSegment = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown, 198.51.100.251;proto=https',
		}),
	)
	expect(responseWithMalformedForwardedProtoSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.251',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers malformed escaped-quote Forwarded proto segments', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedEscapedForwardedProtoSegment =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: 'for="\\"unknown\\", 198.51.100.252;proto=https',
			}),
		)
	expect(responseWithMalformedEscapedForwardedProtoSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.252',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses Forwarded when for appears after other parameters', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithReorderedForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'proto=https;by=198.51.100.1;for=203.0.113.68',
		}),
	)
	expect(responseWithReorderedForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.68',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route handles repeated Forwarded for parameters within a segment', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const cases = [
		{
			forwarded: 'for=unknown;for=198.51.100.166;proto=https',
			canonicalIp: '198.51.100.166',
		},
		{
			forwarded: 'for=198.51.100.167;for=198.51.100.168;proto=https',
			canonicalIp: '198.51.100.167',
		},
		{
			forwarded:
				'proto=https;for=_hidden;for="[::ffff:198.51.100.169]:443";by=proxy',
			canonicalIp: '198.51.100.169',
		},
		{
			forwarded: 'for = unknown; for = 198.51.100.173; proto=https',
			canonicalIp: '198.51.100.173',
		},
		{
			forwarded: 'FOR=198.51.100.174; FOR=198.51.100.175; proto=https',
			canonicalIp: '198.51.100.174',
		},
		{
			forwarded:
				'for="\\"unknown\\", 198.51.100.215";for=198.51.100.176;proto=https',
			canonicalIp: '198.51.100.215',
		},
		{
			forwarded:
				'for="unknown, [::ffff:198.51.100.216]:443";for=198.51.100.177;proto=https',
			canonicalIp: '198.51.100.216',
		},
	] as const

	for (const testCase of cases) {
		const responseWithRepeatedForwardedFor = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: testCase.forwarded,
			}),
		)
		expect(responseWithRepeatedForwardedFor.status).toBe(200)

		const responseWithEquivalentForwardedFor = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': testCase.canonicalIp,
			}),
		)
		expect(responseWithEquivalentForwardedFor.status).toBe(200)

		const events = db
			.query<
				{
					client_fingerprint: string | null
				},
				[string]
			>(
				sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY rowid DESC
					LIMIT 2;
				`,
			)
			.all(ctx.feed.id)

		expect(events).toHaveLength(2)
		expect(events[0]?.client_fingerprint).toBeTruthy()
		expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
	}
})

test('feed route preserves repeated Forwarded for parameter precedence matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedForValues) {
			for (const secondValue of repeatedForwardedForValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const expectedIp =
					getClientIp(
						new Request('https://example.com/feed', {
							headers: {
								Forwarded: `for=${firstValue};proto=https`,
							},
						}),
					) ??
					getClientIp(
						new Request('https://example.com/feed', {
							headers: {
								Forwarded: `for=${secondValue};proto=https`,
							},
						}),
					) ??
					null

				const responseWithRepeatedForwarded = await feedHandler.action(
					createFeedActionContext(ctx.token, {
						Forwarded: repeatedHeader,
					}),
				)
				expect(responseWithRepeatedForwarded.status).toBe(200)

				const canonicalHeaders: Record<string, string> = {}
				if (expectedIp !== null) {
					canonicalHeaders['X-Forwarded-For'] = expectedIp
				}
				const responseWithCanonicalHeader = await feedHandler.action(
					createFeedActionContext(ctx.token, canonicalHeaders),
				)
				expect(responseWithCanonicalHeader.status).toBe(200)

				const events = db
					.query<
						{
							client_fingerprint: string | null
						},
						[string]
					>(
						sql`
							SELECT client_fingerprint
							FROM feed_analytics_events
							WHERE feed_id = ? AND event_type = 'rss_fetch'
							ORDER BY rowid DESC
							LIMIT 2;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(2)
				expect(events[0]?.client_fingerprint).toBe(
					events[1]?.client_fingerprint,
				)
			}
		}
	}
})

test('feed route preserves triple repeated Forwarded for parameter precedence matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedTripleForValues) {
			for (const secondValue of repeatedForwardedTripleForValues) {
				for (const thirdValue of repeatedForwardedTripleForValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const expectedIp =
						getClientIp(
							new Request('https://example.com/feed', {
								headers: {
									Forwarded: `for=${firstValue};proto=https`,
								},
							}),
						) ??
						getClientIp(
							new Request('https://example.com/feed', {
								headers: {
									Forwarded: `for=${secondValue};proto=https`,
								},
							}),
						) ??
						getClientIp(
							new Request('https://example.com/feed', {
								headers: {
									Forwarded: `for=${thirdValue};proto=https`,
								},
							}),
						) ??
						null

					const responseWithRepeatedForwarded = await feedHandler.action(
						createFeedActionContext(ctx.token, {
							Forwarded: repeatedHeader,
						}),
					)
					expect(responseWithRepeatedForwarded.status).toBe(200)

					const canonicalHeaders: Record<string, string> = {}
					if (expectedIp !== null) {
						canonicalHeaders['X-Forwarded-For'] = expectedIp
					}
					const responseWithCanonicalHeader = await feedHandler.action(
						createFeedActionContext(ctx.token, canonicalHeaders),
					)
					expect(responseWithCanonicalHeader.status).toBe(200)

					const events = db
						.query<
							{
								client_fingerprint: string | null
							},
							[string]
						>(
							sql`
								SELECT client_fingerprint
								FROM feed_analytics_events
								WHERE feed_id = ? AND event_type = 'rss_fetch'
								ORDER BY rowid DESC
								LIMIT 2;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(2)
					expect(events[0]?.client_fingerprint).toBe(
						events[1]?.client_fingerprint,
					)
				}
			}
		}
	}
})

test('feed route keeps earliest valid Forwarded candidate when bare malformed segment follows', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedBareSegment = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=198.51.100.201, nonsense,for=198.51.100.202;proto=https',
		}),
	)
	expect(responseWithMalformedBareSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.201',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route keeps earliest valid quoted Forwarded candidate when bare malformed segment follows', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedBareSegment = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded:
				'for="198.51.100.211", nonsense,for=198.51.100.212;proto=https',
		}),
	)
	expect(responseWithMalformedBareSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.211',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route preserves first valid Forwarded candidate across trailing segment noise matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const trailingSegments = [
		'nonsense',
		'proto=https',
		'by=proxy',
		'host=example.com',
		'for=unknown;proto=https',
		'for="_hidden";proto=https',
		'for="unknown";proto=https',
	]

	const forwardedHeaders = trailingSegments.map(
		(trailingSegment) =>
			`for=198.51.100.218;proto=https,${trailingSegment},for=198.51.100.219;proto=https`,
	)

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.218',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route normalizes nested mapped Forwarded chains when for appears after other parameters', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forwardedHeaders = [
		'proto=https;by=198.51.100.1;for="unknown, for=for=[::ffff:198.51.100.193]:443";host=example.com',
		'proto=https;by=198.51.100.1;for="unknown, FOR = for = [::ffff:c633:64c1]:443;proto=https";host=example.com',
		'by=198.51.100.1;host=example.com;for="unknown, FOR = FOR = [::FFFF:C633:64C1]:443";proto=https',
	]

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.193',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route normalizes reordered Forwarded nested prefix matrix for mapped values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forms = ['for=', 'for =', 'FOR=', 'FOR =']
	const wrappers = [
		(candidate: string) =>
			`proto=https;by=198.51.100.1;for="unknown, ${candidate}";host=example.com`,
		(candidate: string) =>
			`host=example.com;proto=https;for="unknown, ${candidate};proto=https";by=198.51.100.1`,
	]
	const mappedIpv6 = '[::ffff:198.51.100.196]:443'

	const buildNestedPrefixes = (
		depth: number,
		accumulatedPrefixes: string[] = [],
	): string[][] => {
		if (depth === 0) return [accumulatedPrefixes]
		const combinations: string[][] = []
		for (const form of forms) {
			combinations.push(
				...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
			)
		}
		return combinations
	}

	const forwardedHeaders: string[] = []
	for (const depth of [1, 2]) {
		for (const prefixCombination of buildNestedPrefixes(depth)) {
			const candidate = `${prefixCombination.join('')}${mappedIpv6}`
			for (const wrapCandidate of wrappers) {
				forwardedHeaders.push(wrapCandidate(candidate))
			}
		}
	}

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.196',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route normalizes reordered escaped-quote Forwarded nested prefix matrix for mapped values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forms = ['for=', 'for =', 'FOR=', 'FOR =']
	const wrappers = [
		(candidate: string) =>
			`proto=https;by=198.51.100.1;for="\\"unknown\\", ${candidate}";host=example.com`,
		(candidate: string) =>
			`by=198.51.100.1;host=example.com;for="\\"unknown\\", ${candidate};proto=https";proto=https`,
	]
	const mappedIpv6 = '[::ffff:198.51.100.197]:443'

	const buildNestedPrefixes = (
		depth: number,
		accumulatedPrefixes: string[] = [],
	): string[][] => {
		if (depth === 0) return [accumulatedPrefixes]
		const combinations: string[][] = []
		for (const form of forms) {
			combinations.push(
				...buildNestedPrefixes(depth - 1, [...accumulatedPrefixes, form]),
			)
		}
		return combinations
	}

	const forwardedHeaders: string[] = []
	for (const depth of [1, 2]) {
		for (const prefixCombination of buildNestedPrefixes(depth)) {
			const candidate = `${prefixCombination.join('')}${mappedIpv6}`
			for (const wrapCandidate of wrappers) {
				forwardedHeaders.push(wrapCandidate(candidate))
			}
		}
	}

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.197',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route falls through reordered nested invalid Forwarded chains to later valid candidates', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const forwardedHeaders = [
		'proto=https;by=198.51.100.1;for="unknown, for=for=_hidden";host=example.com,for=198.51.100.198;proto=https',
		'proto=https;by=198.51.100.1;for="\\"unknown\\", FOR = for = _hidden;proto=https";host=example.com,for=198.51.100.198;proto=https',
		'host=example.com;proto=https;for="unknown, for=for=unknown";by=198.51.100.1,for=198.51.100.198;proto=https',
	]

	for (const forwarded of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.198',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route prefers Forwarded over X-Real-IP when X-Forwarded-For is missing', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithForwardedAndRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=203.0.113.67;proto=https',
			'X-Real-IP': '198.51.100.127',
		}),
	)
	expect(responseWithForwardedAndRealIp.status).toBe(200)

	const responseWithEquivalentForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=203.0.113.67;proto=https',
		}),
	)
	expect(responseWithEquivalentForwarded.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route applies X-Forwarded-For, Forwarded, then X-Real-IP precedence matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const cases = [
		{
			headers: {
				'X-Forwarded-For': 'unknown, 203.0.113.121',
				Forwarded: 'for=198.51.100.131;proto=https',
				'X-Real-IP': '198.51.100.141',
			},
			canonicalIp: '203.0.113.121',
		},
		{
			headers: {
				'X-Forwarded-For': 'unknown, nonsense',
				Forwarded: 'for=198.51.100.132;proto=https',
				'X-Real-IP': '198.51.100.142',
			},
			canonicalIp: '198.51.100.132',
		},
		{
			headers: {
				'X-Forwarded-For': 'unknown, nonsense',
				Forwarded: 'for=unknown;proto=https',
				'X-Real-IP': '"198.51.100.143:8443"',
			},
			canonicalIp: '198.51.100.143',
		},
	] as const

	for (const testCase of cases) {
		const responseWithHeaderMatrix = await feedHandler.action(
			createFeedActionContext(ctx.token, testCase.headers),
		)
		expect(responseWithHeaderMatrix.status).toBe(200)

		const responseWithCanonicalForwardedFor = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': testCase.canonicalIp,
			}),
		)
		expect(responseWithCanonicalForwardedFor.status).toBe(200)

		const events = db
			.query<
				{
					client_fingerprint: string | null
				},
				[string]
			>(
				sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY rowid DESC
					LIMIT 2;
				`,
			)
			.all(ctx.feed.id)

		expect(events).toHaveLength(2)
		expect(events[0]?.client_fingerprint).toBeTruthy()
		expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
	}
})

test('feed route preserves cross-header precedence across segment combination matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const xForwardedForValues = crossHeaderXForwardedForValues
	const forwardedValues = crossHeaderForwardedValues
	const xRealIpValues = crossHeaderXRealIpValues
	const userAgent = 'Pocket Casts/7.0'

	const readLatestClientEvent = () =>
		db
			.query<
				{
					client_fingerprint: string | null
					client_name: string | null
				},
				[string]
			>(
				sql`
						SELECT client_fingerprint, client_name
						FROM feed_analytics_events
						WHERE feed_id = ? AND event_type = 'rss_fetch'
						ORDER BY rowid DESC
						LIMIT 1;
					`,
			)
			.get(ctx.feed.id) ?? { client_fingerprint: null, client_name: null }

	for (const xForwardedForValue of xForwardedForValues) {
		for (const forwardedValue of forwardedValues) {
			for (const xRealIpValue of xRealIpValues) {
				const headers: Record<string, string> = {}
				if (xForwardedForValue !== null) {
					headers['X-Forwarded-For'] = xForwardedForValue
				}
				if (forwardedValue !== null) {
					headers.Forwarded = forwardedValue
				}
				if (xRealIpValue !== null) {
					headers['X-Real-IP'] = xRealIpValue
				}
				headers['User-Agent'] = userAgent

				const response = await feedHandler.action(
					createFeedActionContext(ctx.token, headers),
				)
				expect(response.status).toBe(200)

				const expectedIp = getClientIp(
					new Request('https://example.com/feed', { headers }),
				)
				const canonicalRequest = new Request('https://example.com/feed', {
					headers:
						expectedIp === null
							? { 'User-Agent': userAgent }
							: {
									'X-Forwarded-For': expectedIp,
									'User-Agent': userAgent,
								},
				})
				const expectedFingerprint = getClientFingerprint(canonicalRequest)

				const latestEvent = readLatestClientEvent()
				expect(latestEvent.client_name).toBe('Pocket Casts')
				expect(latestEvent.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
})

test('feed route uses Forwarded header when X-Forwarded-For candidates are unknown', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithUnknownForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown, unknown:8443',
			Forwarded: 'for=203.0.113.64;proto=https',
		}),
	)
	expect(responseWithUnknownForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.64',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route uses Forwarded header when X-Forwarded-For has non-IP tokens', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithInvalidForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			Forwarded: 'for=203.0.113.65;proto=https',
		}),
	)
	expect(responseWithInvalidForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.65',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls back to X-Real-IP when Forwarded values are unknown', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithUnknownForwarded = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=unknown, for=_hidden',
			'X-Real-IP': '198.51.100.121',
		}),
	)
	expect(responseWithUnknownForwarded.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.121',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route skips malformed Forwarded quoted comma candidates', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedForwardedCandidate = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="unknown,proxy", for=203.0.113.63',
		}),
	)
	expect(responseWithMalformedForwardedCandidate.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.63',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls back to X-Real-IP when X-Forwarded-For unknown values include ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithUnknownForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'unknown:8443, unknown',
			'X-Real-IP': '198.51.100.123',
		}),
	)
	expect(responseWithUnknownForwardedFor.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.123',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route falls back to X-Real-IP when X-Forwarded-For contains non-IP values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithInvalidForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			'X-Real-IP': '198.51.100.125',
		}),
	)
	expect(responseWithInvalidForwardedFor.status).toBe(200)

	const responseWithEquivalentRealIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Real-IP': '198.51.100.125',
		}),
	)
	expect(responseWithEquivalentRealIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes Forwarded IPv4 values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithForwardedPort = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for=203.0.113.62:8443;proto=https',
		}),
	)
	expect(responseWithForwardedPort.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.62',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes Forwarded IPv6 values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithForwardedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="[2001:db8:cafe::23]:4711";proto=https',
		}),
	)
	expect(responseWithForwardedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8:cafe::23',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes X-Forwarded-For bracketed IPv6 values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithBracketedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '[2001:db8:cafe::32]:8443',
		}),
	)
	expect(responseWithBracketedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8:cafe::32',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes quoted X-Forwarded-For values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithQuotedForwardedForPort = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '"198.51.100.153:8443"',
		}),
	)
	expect(responseWithQuotedForwardedForPort.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.153',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses quoted whole-chain X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '"203.0.113.202, 198.51.100.202"',
		}),
	)
	expect(responseWithQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.202',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling trailing quotes in X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingTrailingQuoteForwardedFor =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown, 203.0.113.249"',
			}),
		)
	expect(responseWithDanglingTrailingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.249',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling trailing quotes in X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingTrailingQuoteForwardedFor =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': 'unknown, 203.0.113.246""',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.246',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers dangling leading quotes in X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithDanglingLeadingQuoteForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '"unknown, 203.0.113.243',
		}),
	)
	expect(responseWithDanglingLeadingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.243',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers repeated dangling leading quotes in X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithRepeatedDanglingLeadingQuoteForwardedFor =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': '""unknown, 203.0.113.242',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.242',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route parses escaped-quote whole-chain X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithEscapedQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '"\\"unknown\\", 203.0.113.232"',
		}),
	)
	expect(responseWithEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.232',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers from malformed quoted whole-chain X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedQuotedForwardedForChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '"unknown, 203.0.113.217, 198.51.100.217',
		}),
	)
	expect(responseWithMalformedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.217',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers from malformed escaped-quote whole-chain X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedEscapedQuotedForwardedForChain =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.246',
			}),
		)
	expect(responseWithMalformedEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.246',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route recovers escaped-quote chains with repeated trailing quotes in X-Forwarded-For values', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithEscapedChainRepeatedTrailingQuoteForwardedFor =
		await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.241\\"\\"',
			}),
		)
	expect(responseWithEscapedChainRepeatedTrailingQuoteForwardedFor.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.241',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
					SELECT client_fingerprint
					FROM feed_analytics_events
					WHERE feed_id = ? AND event_type = 'rss_fetch'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes uppercase IPv6 header forms', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithUppercaseIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:DB8:CAFE::44',
		}),
	)
	expect(responseWithUppercaseIpv6.status).toBe(200)

	const responseWithLowercaseIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8:cafe::44',
		}),
	)
	expect(responseWithLowercaseIpv6.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes expanded IPv6 header forms', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithExpandedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:0db8:cafe:0000:0000:0000:0000:0067',
		}),
	)
	expect(responseWithExpandedIpv6.status).toBe(200)

	const responseWithCompressedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '2001:db8:cafe::67',
		}),
	)
	expect(responseWithCompressedIpv6.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route skips malformed bracketed X-Forwarded-For IPv6 candidates', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMalformedFirstCandidate = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '[2001:db8:cafe::33, 198.51.100.86',
		}),
	)
	expect(responseWithMalformedFirstCandidate.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.86',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes IPv4-mapped IPv6 Forwarded values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMappedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="[::ffff:203.0.113.91]:443";proto=https',
		}),
	)
	expect(responseWithMappedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '::ffff:203.0.113.91',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route normalizes hexadecimal mapped IPv6 Forwarded values with ports', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithHexMappedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="[::ffff:cb00:710f]:443";proto=https',
		}),
	)
	expect(responseWithHexMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.15',
		}),
	)
	expect(responseWithPlainIpv4.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route aligns mapped IPv6 and plain IPv4 fingerprints', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithMappedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			Forwarded: 'for="[::ffff:203.0.113.93]:443";proto=https',
		}),
	)
	expect(responseWithMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.93',
		}),
	)
	expect(responseWithPlainIpv4.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route aligns hex and dotted mapped IPv6 fingerprints', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithHexMappedIpv6 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '::ffff:cb00:710c',
		}),
	)
	expect(responseWithHexMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.12',
		}),
	)
	expect(responseWithPlainIpv4.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route uses first forwarded IP for analytics fingerprinting', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const responseWithProxyChain = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.7, 198.51.100.17',
		}),
	)
	expect(responseWithProxyChain.status).toBe(200)

	const responseWithSingleIp = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '203.0.113.7',
		}),
	)
	expect(responseWithSingleIp.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('feed route preserves first valid X-Forwarded-For candidate across trailing segment noise matrix', async () => {
	using ctx = createDirectoryFeedRouteTestContext()

	const trailingSegments = [
		'nonsense',
		'unknown',
		'_hidden',
		'"unknown"',
		'"\\"unknown\\", 198.51.100.248"',
		'198.51.100.249:8080',
		'[2001:db8::90]:443',
	]

	const forwardedHeaders = trailingSegments.map(
		(trailingSegment) => `198.51.100.246,${trailingSegment},198.51.100.247`,
	)

	for (const forwardedFor of forwardedHeaders) {
		const response = await feedHandler.action(
			createFeedActionContext(ctx.token, {
				'X-Forwarded-For': forwardedFor,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await feedHandler.action(
		createFeedActionContext(ctx.token, {
			'X-Forwarded-For': '198.51.100.246',
		}),
	)
	expect(responseWithEquivalentForwardedFor.status).toBe(200)

	const events = db
		.query<
			{
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'rss_fetch';
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(forwardedHeaders.length + 1)
	const uniqueFingerprints = new Set(
		events.map((event) => event.client_fingerprint),
	)
	expect(uniqueFingerprints.size).toBe(1)
	expect(Array.from(uniqueFingerprints)[0]).toBeTruthy()
})

test('feed route does not log analytics for revoked directory tokens', async () => {
	using ctx = createDirectoryFeedRouteTestContext()
	expect(revokeDirectoryFeedToken(ctx.token)).toBe(true)

	const response = await feedHandler.action(createFeedActionContext(ctx.token))
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
		.get(ctx.token)

	expect(events?.count ?? 0).toBe(0)
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
