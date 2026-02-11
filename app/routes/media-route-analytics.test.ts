import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import {
	createDirectoryFeedToken,
	revokeDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { addItemToFeed } from '#app/db/feed-items.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import mediaHandler from './media.ts'

migrate(db)

type MediaActionContext = Parameters<typeof mediaHandler.action>[0]

async function createMediaAnalyticsTestContext(options?: {
	includeSecondaryRoot?: boolean
}) {
	const previousMediaPaths = Bun.env.MEDIA_PATHS
	const rootName = `media-route-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'episode.mp3'
	const filePath = path.join(rootPath, relativePath)
	const secondaryRootName = options?.includeSecondaryRoot
		? `media-route-secondary-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
		: null
	const secondaryRootPath = secondaryRootName
		? path.join('/tmp', secondaryRootName)
		: null
	const secondaryRelativePath = secondaryRootName ? 'other-episode.mp3' : null
	const secondaryFilePath =
		secondaryRootPath && secondaryRelativePath
			? path.join(secondaryRootPath, secondaryRelativePath)
			: null

	mkdirSync(rootPath, { recursive: true })
	await Bun.write(filePath, '0123456789abcdefghijklmnopqrstuvwxyz')
	if (secondaryRootPath && secondaryFilePath) {
		mkdirSync(secondaryRootPath, { recursive: true })
		await Bun.write(secondaryFilePath, 'secondary media data')
	}

	const mediaPaths = [`${rootName}:${rootPath}`]
	if (secondaryRootName && secondaryRootPath) {
		mediaPaths.push(`${secondaryRootName}:${secondaryRootPath}`)
	}
	Bun.env.MEDIA_PATHS = mediaPaths.join(',')
	initEnv()

	const feed = createDirectoryFeed({
		name: `media-route-feed-${Date.now()}`,
		directoryPaths: [rootName],
	})
	const token = createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Media route token',
	})

	return {
		rootName,
		relativePath,
		secondaryRootName,
		secondaryRelativePath,
		feed,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteDirectoryFeed(feed.id)

			if (previousMediaPaths === undefined) {
				delete Bun.env.MEDIA_PATHS
			} else {
				Bun.env.MEDIA_PATHS = previousMediaPaths
			}
			initEnv()

			rmSync(rootPath, { recursive: true, force: true })
			if (secondaryRootPath) {
				rmSync(secondaryRootPath, { recursive: true, force: true })
			}
		},
	}
}

async function createCuratedMediaAnalyticsTestContext() {
	const previousMediaPaths = Bun.env.MEDIA_PATHS
	const rootName = `curated-media-route-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'curated-episode.mp3'
	const otherRelativePath = 'not-in-feed.mp3'
	const filePath = path.join(rootPath, relativePath)
	const otherFilePath = path.join(rootPath, otherRelativePath)

	mkdirSync(rootPath, { recursive: true })
	await Bun.write(filePath, 'curated media fixture bytes')
	await Bun.write(otherFilePath, 'excluded fixture bytes')

	Bun.env.MEDIA_PATHS = `${rootName}:${rootPath}`
	initEnv()

	const feed = createCuratedFeed({
		name: `media-route-curated-feed-${Date.now()}`,
		description: 'Curated media route analytics feed',
	})
	const token = createCuratedFeedToken({
		feedId: feed.id,
		label: 'Curated media route token',
	})
	addItemToFeed(feed.id, rootName, relativePath)

	return {
		rootName,
		relativePath,
		otherRelativePath,
		feed,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			db.query(sql`DELETE FROM feed_analytics_events WHERE feed_id = ?;`).run(
				feed.id,
			)
			deleteCuratedFeed(feed.id)

			if (previousMediaPaths === undefined) {
				delete Bun.env.MEDIA_PATHS
			} else {
				Bun.env.MEDIA_PATHS = previousMediaPaths
			}
			initEnv()

			rmSync(rootPath, { recursive: true, force: true })
		},
	}
}

function createMediaActionContext(
	token: string,
	pathParam: string,
	headers: Record<string, string> = {},
): MediaActionContext {
	const request = new Request(`http://localhost/media/${token}/${pathParam}`, {
		headers,
	})
	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: {
			token,
			path: pathParam,
		},
	} as unknown as MediaActionContext
}

function createMediaActionContextWithoutPath(
	token: string,
	headers: Record<string, string> = {},
): MediaActionContext {
	const request = new Request(`http://localhost/media/${token}`, {
		headers,
	})
	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: {
			token,
			path: undefined,
		},
	} as unknown as MediaActionContext
}

test('media route logs media_request analytics for full and ranged requests', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const clientHeaders = {
		'User-Agent': 'AntennaPod/3.0',
		'X-Forwarded-For': '198.51.100.42',
	}

	const fullResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, clientHeaders),
	)
	expect(fullResponse.status).toBe(200)

	const rangedResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			...clientHeaders,
			Range: 'bytes=10-',
		}),
	)
	expect(rangedResponse.status).toBe(206)

	const rangeFromStartResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			...clientHeaders,
			Range: 'bytes=0-',
		}),
	)
	expect(rangeFromStartResponse.status).toBe(206)

	const events = db
		.query<
			{
				status_code: number
				is_download_start: number
				bytes_served: number | null
				media_root: string | null
				relative_path: string | null
				client_name: string | null
				client_fingerprint: string | null
			},
			[string]
		>(
			sql`
				SELECT status_code, is_download_start, bytes_served, media_root, relative_path, client_name, client_fingerprint
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at ASC, id ASC;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(3)

	const hasFullStartEvent = events.some(
		(event) =>
			event.status_code === 200 &&
			event.is_download_start === 1 &&
			event.media_root === ctx.rootName &&
			event.relative_path === ctx.relativePath &&
			event.client_name === 'AntennaPod' &&
			(event.bytes_served ?? 0) > 0 &&
			Boolean(event.client_fingerprint),
	)
	expect(hasFullStartEvent).toBe(true)

	const hasPartialNonStartEvent = events.some(
		(event) =>
			event.status_code === 206 &&
			event.is_download_start === 0 &&
			event.media_root === ctx.rootName &&
			event.relative_path === ctx.relativePath &&
			event.client_name === 'AntennaPod' &&
			(event.bytes_served ?? 0) > 0 &&
			Boolean(event.client_fingerprint),
	)
	expect(hasPartialNonStartEvent).toBe(true)

	const hasPartialStartEvent = events.some(
		(event) =>
			event.status_code === 206 &&
			event.is_download_start === 1 &&
			event.media_root === ctx.rootName &&
			event.relative_path === ctx.relativePath &&
			event.client_name === 'AntennaPod' &&
			(event.bytes_served ?? 0) > 0 &&
			Boolean(event.client_fingerprint),
	)
	expect(hasPartialStartEvent).toBe(true)
})

test('media route logs analytics for curated feed items', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'User-Agent': 'AppleCoreMedia/1.0',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				feed_type: string
				token: string
				media_root: string | null
				relative_path: string | null
				client_name: string | null
			},
			[string]
		>(
			sql`
				SELECT feed_type, token, media_root, relative_path, client_name
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		feed_type: 'curated',
		token: ctx.token,
		media_root: ctx.rootName,
		relative_path: ctx.relativePath,
		client_name: 'AppleCoreMedia',
	})
})

test('media route stores null client metadata for curated requests without traits', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
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
				WHERE feed_id = ? AND event_type = 'media_request'
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

test('media route records fallback client name for unknown user-agents', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'User-Agent': 'CustomPlayer/9.1 (Android)',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event?.client_name).toBe('CustomPlayer/9.1')
	expect(event?.client_fingerprint).toBeTruthy()
})

test('media route fingerprints requests with X-Real-IP and no user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.23',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event?.client_name).toBeNull()
	expect(event?.client_fingerprint).toBeTruthy()
})

test('media route normalizes X-Real-IP values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRealIpPort = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.149:8443',
		}),
	)
	expect(responseWithRealIpPort.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.149',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes bracketed IPv6 X-Real-IP values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithBracketedIpv6RealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '[2001:db8:cafe::62]:8443',
		}),
	)
	expect(responseWithBracketedIpv6RealIp.status).toBe(200)

	const responseWithEquivalentIpv6RealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '2001:db8:cafe::62',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes quoted X-Real-IP values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithQuotedRealIpPort = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '"198.51.100.152:8443"',
		}),
	)
	expect(responseWithQuotedRealIpPort.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.152',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route uses first valid value from comma-separated X-Real-IP header', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRealIpChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': 'unknown, "198.51.100.157:8443", 198.51.100.158',
		}),
	)
	expect(responseWithRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.157',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses quoted whole-chain X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithQuotedRealIpChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '"unknown, 198.51.100.162:8443"',
		}),
	)
	expect(responseWithQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.162',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling trailing quotes in X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingTrailingQuoteRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '198.51.100.239"',
		}),
	)
	expect(responseWithDanglingTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.239',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling trailing quotes in X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingTrailingQuoteRealIp =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '198.51.100.231""',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.231',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling leading quotes in X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingLeadingQuoteRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"198.51.100.236',
		}),
	)
	expect(responseWithDanglingLeadingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.236',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling leading quotes in X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingLeadingQuoteRealIp =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '""198.51.100.233',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.233',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses escaped-quote whole-chain X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithEscapedQuotedRealIpChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"\\"unknown\\", 198.51.100.228:8443"',
		}),
	)
	expect(responseWithEscapedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.228',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers from malformed quoted whole-chain X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedQuotedRealIpChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown',
			'X-Real-IP': '"unknown, 198.51.100.219:8443, 198.51.100.220',
		}),
	)
	expect(responseWithMalformedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.219',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers from malformed escaped-quote whole-chain X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedEscapedQuotedRealIpChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '"\\"unknown\\", 198.51.100.247:8443',
			}),
		)
	expect(responseWithMalformedEscapedQuotedRealIpChain.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.247',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers escaped-quote chains with repeated trailing quotes in X-Real-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithEscapedChainRepeatedTrailingQuoteRealIp =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': '"\\"unknown\\", 198.51.100.230\\"\\"',
			}),
		)
	expect(responseWithEscapedChainRepeatedTrailingQuoteRealIp.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.230',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route stores null fingerprint for all-invalid comma-separated X-Real-IP header', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': 'unknown, proxy.internal, "198.51.100.160:abc"',
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
				WHERE feed_id = ? AND event_type = 'media_request'
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

test('media route stores null fingerprint when proxy IP headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
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

test('media route uses Forwarded header when X-Forwarded-For is missing', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=203.0.113.71;proto=https',
		}),
	)
	expect(responseWithForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.71',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses quoted whole-chain Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithQuotedForwardedForChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown, 203.0.113.208";proto=https',
		}),
	)
	expect(responseWithQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.208',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling trailing quotes in Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingTrailingQuoteForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=198.51.100.238";proto=https',
		}),
	)
	expect(responseWithDanglingTrailingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.238',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling trailing quotes in Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingTrailingQuoteForwarded =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for=198.51.100.232"";proto=https',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling leading quotes in Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingLeadingQuoteForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="198.51.100.235;proto=https',
		}),
	)
	expect(responseWithDanglingLeadingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.235',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling leading quotes in Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingLeadingQuoteForwarded =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for=""198.51.100.234;proto=https',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses escaped-quote whole-chain Forwarded for values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithEscapedQuotedForwardedForChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="\\"unknown\\", 198.51.100.229:8443";proto=https',
		}),
	)
	expect(responseWithEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers from malformed quoted Forwarded chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedQuotedForwardedForChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, 203.0.113.216, for=198.51.100.216;proto=https',
			}),
		)
	expect(responseWithMalformedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.216',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers malformed Forwarded quoted for chains split before proto segment', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedSplitForwardedChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="""unknown", 198.51.100.252;proto=https',
		}),
	)
	expect(responseWithMalformedSplitForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers malformed Forwarded quoted for chains split without whitespace before proto segment', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedSplitForwardedChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="""unknown",198.51.100.238;proto=https',
		}),
	)
	expect(responseWithMalformedSplitForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.238',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route falls through malformed Forwarded first segment to later valid for candidate', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedThenValidForwardedChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="""unknown",proto=https,for=198.51.100.237;proto=https',
			}),
		)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.237',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers nested forwarded for tokens inside quoted for chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedForwardedForToken = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown, for=198.51.100.234";proto=https',
		}),
	)
	expect(responseWithNestedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers quoted nested forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedQuotedForwardedForToken = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown, "for=198.51.100.227"";proto=https',
		}),
	)
	expect(responseWithNestedQuotedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers nested uppercase forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, FOR = 198.51.100.231";proto=https',
			}),
		)
	expect(responseWithNestedUppercaseForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.231',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers nested forwarded ipv6 tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6ForwardedForToken = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown, for=[2001:DB8::b]:443";proto=https',
		}),
	)
	expect(responseWithNestedIpv6ForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::b',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers malformed Forwarded proto tail segments', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedForwardedProtoSegment = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown, 198.51.100.253;proto=https',
		}),
	)
	expect(responseWithMalformedForwardedProtoSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers malformed escaped-quote Forwarded proto segments', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedEscapedForwardedProtoSegment =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="\\"unknown\\", 198.51.100.254;proto=https',
			}),
		)
	expect(responseWithMalformedEscapedForwardedProtoSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses Forwarded when for appears after other parameters', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithReorderedForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'proto=https;by=198.51.100.1;for=203.0.113.78',
		}),
	)
	expect(responseWithReorderedForwarded.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.78',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route prefers Forwarded over X-Real-IP when X-Forwarded-For is missing', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithForwardedAndRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=203.0.113.77;proto=https',
			'X-Real-IP': '198.51.100.137',
		}),
	)
	expect(responseWithForwardedAndRealIp.status).toBe(200)

	const responseWithEquivalentForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=203.0.113.77;proto=https',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route uses Forwarded header when X-Forwarded-For candidates are unknown', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithUnknownForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown, unknown:8443',
			Forwarded: 'for=203.0.113.75;proto=https',
		}),
	)
	expect(responseWithUnknownForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.75',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route uses Forwarded header when X-Forwarded-For has non-IP tokens', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithInvalidForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			Forwarded: 'for=203.0.113.76;proto=https',
		}),
	)
	expect(responseWithInvalidForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.76',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route falls back to X-Real-IP when Forwarded values are unknown', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithUnknownForwarded = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=unknown, for=_hidden',
			'X-Real-IP': '198.51.100.131',
		}),
	)
	expect(responseWithUnknownForwarded.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.131',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route skips malformed Forwarded quoted comma candidates', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedForwardedCandidate = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="unknown,proxy", for=203.0.113.74',
		}),
	)
	expect(responseWithMalformedForwardedCandidate.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.74',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route falls back to X-Real-IP when X-Forwarded-For unknown values include ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithUnknownForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'unknown:8443, unknown',
			'X-Real-IP': '198.51.100.133',
		}),
	)
	expect(responseWithUnknownForwardedFor.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.133',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route falls back to X-Real-IP when X-Forwarded-For contains non-IP values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithInvalidForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			'X-Real-IP': '198.51.100.135',
		}),
	)
	expect(responseWithInvalidForwardedFor.status).toBe(200)

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Real-IP': '198.51.100.135',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes Forwarded IPv4 values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithForwardedPort = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=203.0.113.73:8443;proto=https',
		}),
	)
	expect(responseWithForwardedPort.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.73',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes Forwarded IPv6 values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithForwardedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="[2001:db8:cafe::41]:4711";proto=https',
		}),
	)
	expect(responseWithForwardedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8:cafe::41',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes X-Forwarded-For bracketed IPv6 values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithBracketedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '[2001:db8:cafe::42]:8443',
		}),
	)
	expect(responseWithBracketedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8:cafe::42',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes quoted X-Forwarded-For values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithQuotedForwardedForPort = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '"198.51.100.154:8443"',
		}),
	)
	expect(responseWithQuotedForwardedForPort.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.154',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses quoted whole-chain X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithQuotedForwardedForChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '"203.0.113.203, 198.51.100.203"',
		}),
	)
	expect(responseWithQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.203',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling trailing quotes in X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingTrailingQuoteForwardedFor =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown, 203.0.113.237"',
			}),
		)
	expect(responseWithDanglingTrailingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.237',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling trailing quotes in X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingTrailingQuoteForwardedFor =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown, 203.0.113.245""',
			}),
		)
	expect(responseWithRepeatedDanglingTrailingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.245',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers dangling leading quotes in X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithDanglingLeadingQuoteForwardedFor =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': '"unknown, 203.0.113.244',
			}),
		)
	expect(responseWithDanglingLeadingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.244',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers repeated dangling leading quotes in X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithRepeatedDanglingLeadingQuoteForwardedFor =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': '""unknown, 203.0.113.241',
			}),
		)
	expect(responseWithRepeatedDanglingLeadingQuoteForwardedFor.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route parses escaped-quote whole-chain X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithEscapedQuotedForwardedForChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '"\\"unknown\\", 203.0.113.233"',
		}),
	)
	expect(responseWithEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.233',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers from malformed quoted whole-chain X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedQuotedForwardedForChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': '"unknown, 203.0.113.218, 198.51.100.218',
			}),
		)
	expect(responseWithMalformedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.218',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers from malformed escaped-quote whole-chain X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedEscapedQuotedForwardedForChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.247',
			}),
		)
	expect(responseWithMalformedEscapedQuotedForwardedForChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.247',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route recovers escaped-quote chains with repeated trailing quotes in X-Forwarded-For values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithEscapedChainRepeatedTrailingQuoteForwardedFor =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': '"\\"unknown\\", 203.0.113.240\\"\\"',
			}),
		)
	expect(responseWithEscapedChainRepeatedTrailingQuoteForwardedFor.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.240',
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY created_at DESC, id DESC
					LIMIT 2;
				`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes uppercase IPv6 header forms', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithUppercaseIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:DB8:CAFE::54',
		}),
	)
	expect(responseWithUppercaseIpv6.status).toBe(200)

	const responseWithLowercaseIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8:cafe::54',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes expanded IPv6 header forms', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithExpandedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:0db8:cafe:0000:0000:0000:0000:0068',
		}),
	)
	expect(responseWithExpandedIpv6.status).toBe(200)

	const responseWithCompressedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8:cafe::68',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route skips malformed bracketed X-Forwarded-For IPv6 candidates', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedFirstCandidate = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '[2001:db8:cafe::43, 198.51.100.87',
		}),
	)
	expect(responseWithMalformedFirstCandidate.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.87',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes IPv4-mapped IPv6 Forwarded values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMappedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="[::ffff:203.0.113.92]:443";proto=https',
		}),
	)
	expect(responseWithMappedIpv6.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '::ffff:203.0.113.92',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route normalizes hexadecimal mapped IPv6 Forwarded values with ports', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithHexMappedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="[::ffff:cb00:7110]:443";proto=https',
		}),
	)
	expect(responseWithHexMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.16',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route aligns mapped IPv6 and plain IPv4 fingerprints', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMappedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for="[::ffff:203.0.113.94]:443";proto=https',
		}),
	)
	expect(responseWithMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.94',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route aligns hex and dotted mapped IPv6 fingerprints', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithHexMappedIpv6 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '::ffff:cb00:710d',
		}),
	)
	expect(responseWithHexMappedIpv6.status).toBe(200)

	const responseWithPlainIpv4 = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.13',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route uses first forwarded IP for analytics fingerprinting', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithProxyChain = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.17, 198.51.100.77',
		}),
	)
	expect(responseWithProxyChain.status).toBe(200)

	const responseWithSingleIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '203.0.113.17',
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 2;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(2)
	expect(events[0]?.client_fingerprint).toBeTruthy()
	expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
})

test('media route stores null client metadata when request lacks client traits', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
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
				WHERE feed_id = ? AND event_type = 'media_request'
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

test('media route logs ranged request semantics for curated feed items', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const nonStartRangeResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Range: 'bytes=10-',
		}),
	)
	expect(nonStartRangeResponse.status).toBe(206)

	const startRangeResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Range: 'bytes=0-',
		}),
	)
	expect(startRangeResponse.status).toBe(206)

	const events = db
		.query<
			{
				status_code: number
				is_download_start: number
			},
			[string]
		>(
			sql`
				SELECT status_code, is_download_start
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at ASC, id ASC;
			`,
		)
		.all(ctx.feed.id)
	expect(events).toHaveLength(2)

	const hasNonStartRangeEvent = events.some(
		(event) => event.status_code === 206 && event.is_download_start === 0,
	)
	expect(hasNonStartRangeEvent).toBe(true)

	const hasStartRangeEvent = events.some(
		(event) => event.status_code === 206 && event.is_download_start === 1,
	)
	expect(hasStartRangeEvent).toBe(true)
})

test('media route does not log analytics for curated media outside item list', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.otherRelativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

	const events = db
		.query<{ count: number }, [string, string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ? AND relative_path = ?;
			`,
		)
		.get(ctx.feed.id, ctx.otherRelativePath)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for traversal paths on curated feeds', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/../${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics when token is missing', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const missingToken = `missing-token-${Date.now()}`
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(missingToken, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

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

test('media route does not log analytics when path param is missing', async () => {
	await using ctx = await createMediaAnalyticsTestContext()

	const response = await mediaHandler.action(
		createMediaActionContextWithoutPath(ctx.token),
	)
	expect(response.status).toBe(400)
	expect(await response.text()).toBe('File path required')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for malformed path encoding', async () => {
	await using ctx = await createMediaAnalyticsTestContext()

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, '%E0%A4%A'),
	)
	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for invalid path format', async () => {
	await using ctx = await createMediaAnalyticsTestContext()

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, ctx.rootName),
	)
	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path format')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for revoked tokens', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	expect(revokeDirectoryFeedToken(ctx.token)).toBe(true)
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

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

test('media route does not log analytics for missing files', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const missingRelativePath = 'missing-file.mp3'
	const pathParam = `${ctx.rootName}/${missingRelativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('File not found')

	const events = db
		.query<{ count: number }, [string, string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ? AND relative_path = ?;
			`,
		)
		.get(ctx.feed.id, missingRelativePath)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for unknown media roots', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const unknownRoot = `unknown-media-root-${Date.now()}`
	const pathParam = `${unknownRoot}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Unknown media root')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for paths outside feed directories', async () => {
	await using ctx = await createMediaAnalyticsTestContext({
		includeSecondaryRoot: true,
	})
	expect(ctx.secondaryRootName).toBeTruthy()
	expect(ctx.secondaryRelativePath).toBeTruthy()

	const pathParam = `${ctx.secondaryRootName}/${ctx.secondaryRelativePath}`
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

	const events = db
		.query<{ count: number }, [string, string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ? AND media_root = ?;
			`,
		)
		.get(ctx.feed.id, ctx.secondaryRootName!)

	expect(events?.count ?? 0).toBe(0)
})

test('media route does not log analytics for traversal paths on directory feeds', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/../${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(404)
	expect(await response.text()).toBe('Not found')

	const events = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ?;
			`,
		)
		.get(ctx.feed.id)

	expect(events?.count ?? 0).toBe(0)
})

test('media route logs malformed range requests as non-start downloads', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Range: 'bytes=invalid',
		}),
	)
	expect(response.status).toBe(200)

	const event = db
		.query<
			{
				status_code: number
				is_download_start: number
			},
			[string]
		>(
			sql`
				SELECT status_code, is_download_start
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at DESC, id DESC
				LIMIT 1;
			`,
		)
		.get(ctx.feed.id)

	expect(event).toMatchObject({
		status_code: 200,
		is_download_start: 0,
	})
})
