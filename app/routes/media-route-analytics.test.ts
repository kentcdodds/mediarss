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
