import { expect, spyOn, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
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

type LatestMediaEvent = {
	status_code: number
	is_download_start: number
	bytes_served: number | null
	media_root: string | null
	relative_path: string | null
	client_name: string | null
	client_fingerprint: string | null
	token: string
	feed_type: string
}

async function createDirectoryMediaAnalyticsTestContext() {
	const previousMediaPaths = Bun.env.MEDIA_PATHS
	const rootName = `media-route-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'episode.mp3'
	const filePath = path.join(rootPath, relativePath)

	mkdirSync(rootPath, { recursive: true })
	await Bun.write(filePath, '0123456789abcdefghijklmnopqrstuvwxyz')

	Bun.env.MEDIA_PATHS = `${rootName}:${rootPath}`
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

function readLatestMediaEvent(feedId: string): LatestMediaEvent | null {
	return db
		.query<LatestMediaEvent, [string]>(
			sql`
				SELECT status_code, is_download_start, bytes_served, media_root, relative_path, client_name, client_fingerprint, token, feed_type
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid DESC
				LIMIT 1;
			`,
		)
		.get(feedId)
}

function listMediaEvents(feedId: string): LatestMediaEvent[] {
	return db
		.query<LatestMediaEvent, [string]>(
			sql`
				SELECT status_code, is_download_start, bytes_served, media_root, relative_path, client_name, client_fingerprint, token, feed_type
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY rowid ASC;
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

test('media route logs media_request analytics for full and ranged requests', async () => {
	await using ctx = await createDirectoryMediaAnalyticsTestContext()
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

	const events = listMediaEvents(ctx.feed.id)
	expect(events).toHaveLength(3)

	const hasFullStartEvent = events.some(
		(event) =>
			event.status_code === 200 &&
			event.is_download_start === 1 &&
			(event.bytes_served ?? 0) > 0,
	)
	expect(hasFullStartEvent).toBe(true)

	const hasPartialNonStartEvent = events.some(
		(event) =>
			event.status_code === 206 &&
			event.is_download_start === 0 &&
			(event.bytes_served ?? 0) > 0,
	)
	expect(hasPartialNonStartEvent).toBe(true)

	const hasPartialStartEvent = events.some(
		(event) =>
			event.status_code === 206 &&
			event.is_download_start === 1 &&
			(event.bytes_served ?? 0) > 0,
	)
	expect(hasPartialStartEvent).toBe(true)
	expect(events.every((event) => event.client_name !== null)).toBe(true)
})

test('media route still serves files when analytics writes fail', async () => {
	await using ctx = await createDirectoryMediaAnalyticsTestContext()
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
			expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
		})
	} finally {
		consoleErrorSpy.mockRestore()
	}

	expect(countEventsForToken(ctx.token)).toBe(0)
})

test('media route stores null client metadata when request lacks client traits', async () => {
	await using ctx = await createDirectoryMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const response = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(response.status).toBe(200)

	expect(readLatestMediaEvent(ctx.feed.id)).toMatchObject({
		client_name: null,
		client_fingerprint: null,
	})
})

test('media route rejects invalid access cases without logging analytics', async () => {
	await using ctx = await createDirectoryMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const missingPathResponse = await mediaHandler.action(
		createMediaActionContextWithoutPath(ctx.token),
	)
	expect(missingPathResponse.status).toBe(400)
	expect(countEventsForToken(ctx.token)).toBe(0)

	const missingToken = `missing-token-${Date.now()}`
	const missingTokenResponse = await mediaHandler.action(
		createMediaActionContext(missingToken, pathParam),
	)
	expect(missingTokenResponse.status).toBe(404)
	expect(countEventsForToken(missingToken)).toBe(0)

	expect(revokeDirectoryFeedToken(ctx.token)).toBe(true)
	const revokedTokenResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(revokedTokenResponse.status).toBe(404)
	expect(countEventsForToken(ctx.token)).toBe(0)
})

test('media route logs analytics for curated feed items and blocks non-feed files', async () => {
	await using ctx = await createCuratedMediaAnalyticsTestContext()
	const allowedPath = `${ctx.rootName}/${ctx.relativePath}`
	const disallowedPath = `${ctx.rootName}/${ctx.otherRelativePath}`

	const allowedResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, allowedPath, {
			'User-Agent': 'Pocket Casts/7.0',
		}),
	)
	expect(allowedResponse.status).toBe(200)

	const disallowedResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, disallowedPath, {
			'User-Agent': 'Pocket Casts/7.0',
		}),
	)
	expect(disallowedResponse.status).toBe(404)

	const events = listMediaEvents(ctx.feed.id)
	expect(events).toHaveLength(1)
	expect(events[0]).toMatchObject({
		feed_type: 'curated',
		token: ctx.token,
		media_root: ctx.rootName,
		relative_path: ctx.relativePath,
	})
})
