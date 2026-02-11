import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, spyOn, test } from 'bun:test'
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
import {
	getClientFingerprint,
	getClientIp,
} from '#app/helpers/analytics-request.ts'
import {
	crossHeaderInvalidForwardedValues,
	crossHeaderInvalidXForwardedForValues,
	crossHeaderInvalidXRealIpValues,
	crossHeaderForwardedValues,
	crossHeaderXForwardedForValues,
	crossHeaderXRealIpValues,
	repeatedForwardedForHeaderBuilders,
	repeatedForwardedInvalidValues,
	repeatedForwardedForValues,
	repeatedForwardedTripleForHeaderBuilders,
	repeatedForwardedTripleForValues,
} from '#app/helpers/analytics-header-precedence-matrix.ts'
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

test('media route still serves files when analytics writes fail', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})

	try {
		await withAnalyticsTableUnavailable(async () => {
			const response = await mediaHandler.action(
				createMediaActionContext(ctx.token, pathParam, {
					'User-Agent': 'AntennaPod/3.0',
					'X-Forwarded-For': '198.51.100.42',
				}),
			)

			expect(response.status).toBe(200)
			expect(await response.text()).toBe('0123456789abcdefghijklmnopqrstuvwxyz')
		})
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
	} finally {
		consoleErrorSpy.mockRestore()
	}

	const analyticsCount = db
		.query<{ count: number }, [string]>(
			sql`
				SELECT COUNT(*) AS count
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request';
			`,
		)
		.get(ctx.feed.id)

	expect(analyticsCount?.count ?? 0).toBe(0)
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

test('media route preserves first valid X-Real-IP candidate across trailing segment noise matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': 'unknown',
				'X-Real-IP': realIp,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentRealIp = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route stores null fingerprint across all-invalid cross-header matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	for (const xForwardedFor of crossHeaderInvalidXForwardedForValues) {
		for (const forwarded of crossHeaderInvalidForwardedValues) {
			for (const xRealIp of crossHeaderInvalidXRealIpValues) {
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						'X-Forwarded-For': xForwardedFor,
						Forwarded: forwarded,
						'X-Real-IP': xRealIp,
					}),
				)
				expect(response.status).toBe(200)

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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_name).toBeNull()
				expect(events[0]?.client_fingerprint).toBeNull()
			}
		}
	}
})

test('media route falls back to user-agent fingerprint when proxy IP headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithInvalidIpHeaders = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': 'proxy.internal, app.server',
			Forwarded: 'for=unknown',
			'X-Real-IP': '_hidden',
			'User-Agent': 'Pocket Casts/7.0',
		}),
	)
	expect(responseWithInvalidIpHeaders.status).toBe(200)

	const responseWithUserAgentOnly = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request'
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

test('media route uses user-agent fallback across all-invalid cross-header matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const userAgent = 'Pocket Casts/7.0'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const xForwardedFor of crossHeaderInvalidXForwardedForValues) {
		for (const forwarded of crossHeaderInvalidForwardedValues) {
			for (const xRealIp of crossHeaderInvalidXRealIpValues) {
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						'X-Forwarded-For': xForwardedFor,
						Forwarded: forwarded,
						'X-Real-IP': xRealIp,
						'User-Agent': userAgent,
					}),
				)
				expect(response.status).toBe(200)

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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_name).toBe('Pocket Casts')
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
})

test('media route uses unknown user-agent fallback across all-invalid cross-header matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const userAgent = 'CustomPlayer/9.1 (Android)'
	const expectedClientName = 'CustomPlayer/9.1'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const xForwardedFor of crossHeaderInvalidXForwardedForValues) {
		for (const forwarded of crossHeaderInvalidForwardedValues) {
			for (const xRealIp of crossHeaderInvalidXRealIpValues) {
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						'X-Forwarded-For': xForwardedFor,
						Forwarded: forwarded,
						'X-Real-IP': xRealIp,
						'User-Agent': userAgent,
					}),
				)
				expect(response.status).toBe(200)

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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_name).toBe(expectedClientName)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
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

test('media route falls through nested invalid forwarded for token to later valid candidate', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedThenValidForwardedChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=unknown";proto=https,for=198.51.100.231;proto=https',
			}),
		)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

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

test('media route falls through deeply nested obfuscated forwarded for token to later valid candidate', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedThenValidForwardedChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=for=_hidden";proto=https,for=198.51.100.253;proto=https',
			}),
		)
	expect(responseWithMalformedThenValidForwardedChain.status).toBe(200)

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

test('media route recovers nested forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=198.51.100.230;proto=https";proto=https',
			}),
		)
	expect(responseWithNestedParameterizedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6ParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=[2001:db8::c]:443;proto=https";proto=https',
			}),
		)
	expect(responseWithNestedIpv6ParameterizedForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers doubly-prefixed nested forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedDoublePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=for=198.51.100.245";proto=https',
			}),
		)
	expect(responseWithNestedDoublePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.245',
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

test('media route recovers doubly-prefixed nested forwarded ipv6 tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6DoublePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=for=[2001:db8::e]:443";proto=https',
			}),
		)
	expect(responseWithNestedIpv6DoublePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::e',
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

test('media route recovers doubly-prefixed nested forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedDoublePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=198.51.100.250;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.250',
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

test('media route recovers doubly-prefixed nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6DoublePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=[2001:db8::13]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6DoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::13',
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

test('media route recovers triply-prefixed nested forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedTriplePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=for=for=198.51.100.235";proto=https',
			}),
		)
	expect(responseWithNestedTriplePrefixForwardedForToken.status).toBe(200)

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

test('media route recovers triply-prefixed nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6TriplePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=for=[2001:db8::19]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::19',
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

test('media route recovers triply-prefixed nested uppercase forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseTriplePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, FOR=FOR=FOR=198.51.100.240";proto=https',
			}),
		)
	expect(responseWithNestedUppercaseTriplePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers triply-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseIpv6TriplePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR=FOR=FOR=[2001:db8::24]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::24',
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

test('media route recovers quadruply-prefixed nested forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedQuadruplePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=for=for=for=198.51.100.243";proto=https',
			}),
		)
	expect(responseWithNestedQuadruplePrefixForwardedForToken.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers quadruply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6QuadrupleMixedCasePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = [2001:db8::27]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6QuadrupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::27',
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

test('media route recovers quintuply-prefixed mixed-case nested forwarded tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedQuintupleMixedCasePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = FOR = 198.51.100.249;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedQuintupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers quintuply-prefixed mixed-case nested forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedIpv6QuintupleMixedCasePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR = for = FOR = for = FOR = [2001:db8::2a]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedIpv6QuintupleMixedCasePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::2a',
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

test('media route recovers doubly-prefixed nested ipv4-mapped forwarded ipv6 tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedMappedIpv6DoublePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, for=for=[::FFFF:C633:64A0]:443";proto=https',
			}),
		)
	expect(responseWithNestedMappedIpv6DoublePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers doubly-prefixed mixed-case nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedMappedIpv6MixedCaseDoublePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR = FOR = [::ffff:c633:64a1]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedMappedIpv6MixedCaseDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route recovers triply-prefixed nested ipv4-mapped forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedMappedIpv6TriplePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=for=[::FFFF:C633:64A2]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedMappedIpv6TriplePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route normalizes nested dotted mapped forwarded ipv6 prefix matrix inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route normalizes nested hexadecimal mapped forwarded ipv6 prefix matrix inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route falls through deeply nested invalid forwarded for token to later valid candidate', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedInvalidThenValidForwardedChain =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, for=for=for=unknown";proto=https,for=198.51.100.250;proto=https',
			}),
		)
	expect(responseWithNestedInvalidThenValidForwardedChain.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.250',
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

test('media route recovers doubly-prefixed nested uppercase forwarded for tokens inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseDoublePrefixForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: 'for="unknown, FOR=FOR=198.51.100.255";proto=https',
			}),
		)
	expect(responseWithNestedUppercaseDoublePrefixForwardedForToken.status).toBe(
		200,
	)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '198.51.100.255',
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

test('media route recovers doubly-prefixed nested uppercase forwarded for tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseDoublePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR=FOR=198.51.100.254;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseDoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

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

test('media route recovers doubly-prefixed nested uppercase forwarded ipv6 tokens with parameter suffixes inside quoted chains', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithNestedUppercaseIpv6DoublePrefixParameterizedForwardedForToken =
		await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded:
					'for="unknown, FOR=FOR=[2001:db8::16]:443;proto=https";proto=https',
			}),
		)
	expect(
		responseWithNestedUppercaseIpv6DoublePrefixParameterizedForwardedForToken.status,
	).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			'X-Forwarded-For': '2001:db8::16',
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

test('media route handles repeated Forwarded for parameters within a segment', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		{
			forwarded:
				'for="unknown, for=198.51.100.244;proto=https";for=198.51.100.178;proto=https',
			canonicalIp: '198.51.100.244',
		},
		{
			forwarded:
				'for="\\"unknown\\", FOR = [::ffff:198.51.100.245]:443;proto=https";for=198.51.100.179;proto=https',
			canonicalIp: '198.51.100.245',
		},
	] as const

	for (const testCase of cases) {
		const responseWithRepeatedForwardedFor = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: testCase.forwarded,
			}),
		)
		expect(responseWithRepeatedForwardedFor.status).toBe(200)

		const canonicalRequest = new Request('https://example.com/media', {
			headers: {
				'X-Forwarded-For': testCase.canonicalIp,
			},
		})
		const expectedFingerprint = getClientFingerprint(canonicalRequest)

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
					ORDER BY rowid DESC
					LIMIT 1;
				`,
			)
			.all(ctx.feed.id)

		expect(events).toHaveLength(1)
		expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	}
})

test('media route falls back to user-agent fingerprint for invalid repeated Forwarded values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'

	const responseWithRepeatedForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=unknown;for=_hidden;proto=https',
			'User-Agent': userAgent,
		}),
	)
	expect(responseWithRepeatedForwardedFor.status).toBe(200)

	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe('Pocket Casts')
})

test('media route uses user-agent fallback across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
						'User-Agent': userAgent,
					}),
				)
				expect(response.status).toBe(200)

				const events = db
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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
				expect(events[0]?.client_name).toBe('Pocket Casts')
			}
		}
	}
})

test('media route uses unknown user-agent fallback across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'CustomPlayer/9.1 (Android)'
	const expectedClientName = 'CustomPlayer/9.1'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
						'User-Agent': userAgent,
					}),
				)
				expect(response.status).toBe(200)

				const events = db
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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
				expect(events[0]?.client_name).toBe(expectedClientName)
			}
		}
	}
})

test('media route stores null client metadata across repeated Forwarded invalid-value matrix without user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
					}),
				)
				expect(response.status).toBe(200)

				const events = db
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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBeNull()
				expect(events[0]?.client_name).toBeNull()
			}
		}
	}
})

test('media route falls back to X-Real-IP across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.254'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
						'X-Real-IP': `${expectedIp}:443`,
					}),
				)
				expect(response.status).toBe(200)

				const events = db
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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
				expect(events[0]?.client_name).toBeNull()
			}
		}
	}
})

test('media route prefers X-Forwarded-For across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.242'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
						'X-Forwarded-For': `unknown, ${expectedIp}:443`,
						'X-Real-IP': '198.51.100.12',
					}),
				)
				expect(response.status).toBe(200)

				const events = db
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
							WHERE feed_id = ? AND event_type = 'media_request'
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
				expect(events[0]?.client_name).toBeNull()
			}
		}
	}
})

test('media route prefers X-Forwarded-For and preserves unknown user-agent across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.238'
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': `unknown, ${expectedIp}:443`,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route prefers X-Forwarded-For and preserves known user-agent classification across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.244'
	const userAgent = 'Pocket Casts/7.58'
	const expectedClientName = 'Pocket Casts'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': `unknown, ${expectedIp}:443`,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route falls back to X-Real-IP when repeated Forwarded and X-Forwarded-For are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.235'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const invalidXForwardedFor of crossHeaderInvalidXForwardedForValues) {
					const repeatedHeader = buildHeader(firstValue, secondValue)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
							'X-Forwarded-For': invalidXForwardedFor,
							'X-Real-IP': `${expectedIp}:443`,
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
					expect(events[0]?.client_name).toBeNull()
				}
			}
		}
	}
})

test('media route falls back to X-Real-IP and preserves unknown user-agent across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.219'
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': `${expectedIp}:443`,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route falls back to X-Real-IP and preserves known user-agent classification across repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.218'
	const userAgent = 'Pocket Casts/7.58'
	const expectedClientName = 'Pocket Casts'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': `${expectedIp}:443`,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route uses user-agent fallback when repeated Forwarded and other proxy headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe('Pocket Casts')
})

test('media route uses unknown user-agent fallback when repeated Forwarded and other proxy headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route stores null metadata when repeated Forwarded and other proxy headers are invalid without user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const repeatedHeader = repeatedForwardedForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBeNull()
	expect(events[0]?.client_name).toBeNull()
})

test('media route uses user-agent fallback across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
							'User-Agent': userAgent,
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
					expect(events[0]?.client_name).toBe('Pocket Casts')
				}
			}
		}
	}
})

test('media route uses unknown user-agent fallback across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'CustomPlayer/9.1 (Android)'
	const expectedClientName = 'CustomPlayer/9.1'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
							'User-Agent': userAgent,
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
					expect(events[0]?.client_name).toBe(expectedClientName)
				}
			}
		}
	}
})

test('media route stores null client metadata across triple repeated Forwarded invalid-value matrix without user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBeNull()
					expect(events[0]?.client_name).toBeNull()
				}
			}
		}
	}
})

test('media route falls back to X-Real-IP across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.255'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
							'X-Real-IP': `[::ffff:${expectedIp}]:443`,
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
					expect(events[0]?.client_name).toBeNull()
				}
			}
		}
	}
})

test('media route prefers X-Forwarded-For across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.243'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					const repeatedHeader = buildHeader(
						firstValue,
						secondValue,
						thirdValue,
					)
					const response = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
							'X-Forwarded-For': `unknown, [::ffff:${expectedIp}]:443`,
							'X-Real-IP': '198.51.100.13',
						}),
					)
					expect(response.status).toBe(200)

					const events = db
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
								WHERE feed_id = ? AND event_type = 'media_request'
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
					expect(events[0]?.client_name).toBeNull()
				}
			}
		}
	}
})

test('media route prefers X-Forwarded-For and preserves unknown user-agent across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.239'
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': `unknown, [::ffff:${expectedIp}]:443`,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route prefers X-Forwarded-For and preserves known user-agent classification across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.247'
	const userAgent = 'Pocket Casts/7.58'
	const expectedClientName = 'Pocket Casts'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Forwarded-For': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': `unknown, [::ffff:${expectedIp}]:443`,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route falls back to X-Real-IP when triple repeated Forwarded and X-Forwarded-For are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.236'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	for (const buildHeader of repeatedForwardedTripleForHeaderBuilders) {
		for (const firstValue of repeatedForwardedInvalidValues) {
			for (const secondValue of repeatedForwardedInvalidValues) {
				for (const thirdValue of repeatedForwardedInvalidValues) {
					for (const invalidXForwardedFor of crossHeaderInvalidXForwardedForValues) {
						const repeatedHeader = buildHeader(
							firstValue,
							secondValue,
							thirdValue,
						)
						const response = await mediaHandler.action(
							createMediaActionContext(ctx.token, pathParam, {
								Forwarded: repeatedHeader,
								'X-Forwarded-For': invalidXForwardedFor,
								'X-Real-IP': `[::ffff:${expectedIp}]:443`,
							}),
						)
						expect(response.status).toBe(200)

						const events = db
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
									WHERE feed_id = ? AND event_type = 'media_request'
									ORDER BY rowid DESC
									LIMIT 1;
								`,
							)
							.all(ctx.feed.id)

						expect(events).toHaveLength(1)
						expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
						expect(events[0]?.client_name).toBeNull()
					}
				}
			}
		}
	}
})

test('media route falls back to X-Real-IP and preserves unknown user-agent across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.217'
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': `[::ffff:${expectedIp}]:443`,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route falls back to X-Real-IP and preserves known user-agent classification across triple repeated Forwarded invalid-value matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const expectedIp = '198.51.100.216'
	const userAgent = 'Pocket Casts/7.58'
	const expectedClientName = 'Pocket Casts'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'X-Real-IP': expectedIp,
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': `[::ffff:${expectedIp}]:443`,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route uses user-agent fallback when triple repeated Forwarded and other proxy headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe('Pocket Casts')
})

test('media route uses unknown user-agent fallback when triple repeated Forwarded and other proxy headers are invalid', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
	const canonicalRequest = new Request('https://example.com/media', {
		headers: {
			'User-Agent': userAgent,
		},
	})
	const expectedFingerprint = getClientFingerprint(canonicalRequest)

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
			'User-Agent': userAgent,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
	expect(events[0]?.client_name).toBe(expectedClientName)
})

test('media route stores null metadata when triple repeated Forwarded and other proxy headers are invalid without user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const repeatedHeader = repeatedForwardedTripleForHeaderBuilders[0]!(
		'unknown',
		'_hidden',
		'nonsense',
	)
	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: repeatedHeader,
			'X-Forwarded-For': crossHeaderInvalidXForwardedForValues[0]!,
			'X-Real-IP': crossHeaderInvalidXRealIpValues[0]!,
		}),
	)
	expect(response.status).toBe(200)

	const events = db
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
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(1)
	expect(events[0]?.client_fingerprint).toBeNull()
	expect(events[0]?.client_name).toBeNull()
})

test('media route preserves repeated Forwarded for parameter precedence matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	for (const buildHeader of repeatedForwardedForHeaderBuilders) {
		for (const firstValue of repeatedForwardedForValues) {
			for (const secondValue of repeatedForwardedForValues) {
				const repeatedHeader = buildHeader(firstValue, secondValue)
				const expectedIp =
					getClientIp(
						new Request('https://example.com/media', {
							headers: {
								Forwarded: `for=${firstValue};proto=https`,
							},
						}),
					) ??
					getClientIp(
						new Request('https://example.com/media', {
							headers: {
								Forwarded: `for=${secondValue};proto=https`,
							},
						}),
					) ??
					null

				const responseWithRepeatedForwarded = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, {
						Forwarded: repeatedHeader,
					}),
				)
				expect(responseWithRepeatedForwarded.status).toBe(200)

				const canonicalHeaders: Record<string, string> = {}
				if (expectedIp !== null) {
					canonicalHeaders['X-Forwarded-For'] = expectedIp
				}
				const canonicalRequest = new Request('https://example.com/media', {
					headers: canonicalHeaders,
				})
				const expectedFingerprint = getClientFingerprint(canonicalRequest)

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
							ORDER BY rowid DESC
							LIMIT 1;
						`,
					)
					.all(ctx.feed.id)

				expect(events).toHaveLength(1)
				expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
})

test('media route preserves triple repeated Forwarded for parameter precedence matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
							new Request('https://example.com/media', {
								headers: {
									Forwarded: `for=${firstValue};proto=https`,
								},
							}),
						) ??
						getClientIp(
							new Request('https://example.com/media', {
								headers: {
									Forwarded: `for=${secondValue};proto=https`,
								},
							}),
						) ??
						getClientIp(
							new Request('https://example.com/media', {
								headers: {
									Forwarded: `for=${thirdValue};proto=https`,
								},
							}),
						) ??
						null

					const responseWithRepeatedForwarded = await mediaHandler.action(
						createMediaActionContext(ctx.token, pathParam, {
							Forwarded: repeatedHeader,
						}),
					)
					expect(responseWithRepeatedForwarded.status).toBe(200)

					const canonicalHeaders: Record<string, string> = {}
					if (expectedIp !== null) {
						canonicalHeaders['X-Forwarded-For'] = expectedIp
					}
					const canonicalRequest = new Request('https://example.com/media', {
						headers: canonicalHeaders,
					})
					const expectedFingerprint = getClientFingerprint(canonicalRequest)

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
								ORDER BY rowid DESC
								LIMIT 1;
							`,
						)
						.all(ctx.feed.id)

					expect(events).toHaveLength(1)
					expect(events[0]?.client_fingerprint).toBe(expectedFingerprint)
				}
			}
		}
	}
}, 30_000)

test('media route keeps earliest valid Forwarded candidate when bare malformed segment follows', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedBareSegment = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded: 'for=198.51.100.201, nonsense,for=198.51.100.202;proto=https',
		}),
	)
	expect(responseWithMalformedBareSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route keeps earliest valid quoted Forwarded candidate when bare malformed segment follows', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const responseWithMalformedBareSegment = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Forwarded:
				'for="198.51.100.211", nonsense,for=198.51.100.212;proto=https',
		}),
	)
	expect(responseWithMalformedBareSegment.status).toBe(200)

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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

test('media route preserves first valid Forwarded candidate across trailing segment noise matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route normalizes nested mapped Forwarded chains when for appears after other parameters', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const forwardedHeaders = [
		'proto=https;by=198.51.100.1;for="unknown, for=for=[::ffff:198.51.100.193]:443";host=example.com',
		'proto=https;by=198.51.100.1;for="unknown, FOR = for = [::ffff:c633:64c1]:443;proto=https";host=example.com',
		'by=198.51.100.1;host=example.com;for="unknown, FOR = FOR = [::FFFF:C633:64C1]:443";proto=https',
	]

	for (const forwarded of forwardedHeaders) {
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route normalizes reordered Forwarded nested prefix matrix for mapped values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route normalizes reordered escaped-quote Forwarded nested prefix matrix for mapped values', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route falls through reordered nested invalid Forwarded chains to later valid candidates', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const forwardedHeaders = [
		'proto=https;by=198.51.100.1;for="unknown, for=for=_hidden";host=example.com,for=198.51.100.198;proto=https',
		'proto=https;by=198.51.100.1;for="\\"unknown\\", FOR = for = _hidden;proto=https";host=example.com,for=198.51.100.198;proto=https',
		'host=example.com;proto=https;for="unknown, for=for=unknown";by=198.51.100.1,for=198.51.100.198;proto=https',
	]

	for (const forwarded of forwardedHeaders) {
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				Forwarded: forwarded,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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

test('media route applies X-Forwarded-For, Forwarded, then X-Real-IP precedence matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const responseWithHeaderMatrix = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, testCase.headers),
		)
		expect(responseWithHeaderMatrix.status).toBe(200)

		const responseWithCanonicalForwardedFor = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': testCase.canonicalIp,
			}),
		)
		expect(responseWithCanonicalForwardedFor.status).toBe(200)

		const events = db
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY rowid DESC
					LIMIT 2;
				`,
			)
			.all(ctx.feed.id)

		expect(events).toHaveLength(2)
		expect(events[0]?.client_fingerprint).toBeTruthy()
		expect(events[0]?.client_fingerprint).toBe(events[1]?.client_fingerprint)
		expect(events[0]?.client_name).toBeNull()
		expect(events[1]?.client_name).toBeNull()
	}
})

test('media route applies precedence matrix with known user-agent classification', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'Pocket Casts/7.58'
	const expectedClientName = 'Pocket Casts'
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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				...testCase.headers,
				'User-Agent': userAgent,
			}),
		)
		expect(response.status).toBe(200)

		const expectedFingerprint = getClientFingerprint(
			new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
					'User-Agent': userAgent,
				},
			}),
		)

		const latestEvent = db
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY rowid DESC
					LIMIT 1;
				`,
			)
			.get(ctx.feed.id)

		expect(latestEvent?.client_fingerprint).toBe(expectedFingerprint)
		expect(latestEvent?.client_name).toBe(expectedClientName)
	}
})

test('media route applies precedence matrix with unknown user-agent tokenization', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'
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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				...testCase.headers,
				'User-Agent': userAgent,
			}),
		)
		expect(response.status).toBe(200)

		const expectedFingerprint = getClientFingerprint(
			new Request('https://example.com/media', {
				headers: {
					'X-Forwarded-For': testCase.canonicalIp,
					'User-Agent': userAgent,
				},
			}),
		)

		const latestEvent = db
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
					WHERE feed_id = ? AND event_type = 'media_request'
					ORDER BY rowid DESC
					LIMIT 1;
				`,
			)
			.get(ctx.feed.id)

		expect(latestEvent?.client_fingerprint).toBe(expectedFingerprint)
		expect(latestEvent?.client_name).toBe(expectedClientName)
	}
})

test('media route preserves cross-header precedence across segment combination matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const xForwardedForValues = crossHeaderXForwardedForValues
	const forwardedValues = crossHeaderForwardedValues
	const xRealIpValues = crossHeaderXRealIpValues
	const userAgent = 'Pocket Casts/7.0'

	const latestClientEventQuery = db.query<
		{
			client_fingerprint: string | null
			client_name: string | null
		},
		[string]
	>(
		sql`
				SELECT client_fingerprint, client_name
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
	)
	const readLatestClientEvent = () =>
		latestClientEventQuery.get(ctx.feed.id) ?? {
			client_fingerprint: null,
			client_name: null,
		}

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

				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, headers),
				)
				expect(response.status).toBe(200)

				const expectedIp = getClientIp(
					new Request('https://example.com/media', { headers }),
				)
				const canonicalRequest = new Request('https://example.com/media', {
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

test('media route preserves cross-header precedence across segment combination matrix with unknown user-agent tokenization', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const xForwardedForValues = crossHeaderXForwardedForValues
	const forwardedValues = crossHeaderForwardedValues
	const xRealIpValues = crossHeaderXRealIpValues
	const userAgent = 'CustomPodClient/1.2 (Linux)'
	const expectedClientName = 'CustomPodClient/1.2'

	const latestClientEventQuery = db.query<
		{
			client_fingerprint: string | null
			client_name: string | null
		},
		[string]
	>(
		sql`
				SELECT client_fingerprint, client_name
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
	)
	const readLatestClientEvent = () =>
		latestClientEventQuery.get(ctx.feed.id) ?? {
			client_fingerprint: null,
			client_name: null,
		}

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

				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, headers),
				)
				expect(response.status).toBe(200)

				const expectedIp = getClientIp(
					new Request('https://example.com/media', { headers }),
				)
				const canonicalRequest = new Request('https://example.com/media', {
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
				expect(latestEvent.client_name).toBe(expectedClientName)
				expect(latestEvent.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
})

test('media route preserves cross-header precedence across segment combination matrix without user-agent', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const xForwardedForValues = crossHeaderXForwardedForValues
	const forwardedValues = crossHeaderForwardedValues
	const xRealIpValues = crossHeaderXRealIpValues

	const latestClientEventQuery = db.query<
		{
			client_fingerprint: string | null
			client_name: string | null
		},
		[string]
	>(
		sql`
				SELECT client_fingerprint, client_name
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
	)
	const readLatestClientEvent = () =>
		latestClientEventQuery.get(ctx.feed.id) ?? {
			client_fingerprint: null,
			client_name: null,
		}

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

				const response = await mediaHandler.action(
					createMediaActionContext(ctx.token, pathParam, headers),
				)
				expect(response.status).toBe(200)

				const expectedIp = getClientIp(
					new Request('https://example.com/media', { headers }),
				)
				const canonicalRequest = new Request('https://example.com/media', {
					headers:
						expectedIp === null
							? {}
							: {
									'X-Forwarded-For': expectedIp,
								},
				})
				const expectedFingerprint = getClientFingerprint(canonicalRequest)

				const latestEvent = readLatestClientEvent()
				expect(latestEvent.client_name).toBeNull()
				expect(latestEvent.client_fingerprint).toBe(expectedFingerprint)
			}
		}
	}
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

test('media route preserves first valid X-Forwarded-For candidate across trailing segment noise matrix', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

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
		const response = await mediaHandler.action(
			createMediaActionContext(ctx.token, pathParam, {
				'X-Forwarded-For': forwardedFor,
			}),
		)
		expect(response.status).toBe(200)
	}

	const responseWithEquivalentForwardedFor = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
				WHERE feed_id = ? AND event_type = 'media_request';
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
