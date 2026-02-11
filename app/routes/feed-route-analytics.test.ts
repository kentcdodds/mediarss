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
