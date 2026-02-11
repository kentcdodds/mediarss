import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import { createFeedAnalyticsEvent } from '#app/db/feed-analytics-events.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import analyticsHandler from './media-analytics.$path.ts'

migrate(db)

type AnalyticsActionContext = Parameters<typeof analyticsHandler.action>[0]

async function createMediaApiTestContext() {
	const previousMediaPaths = Bun.env.MEDIA_PATHS
	const rootName = `media-analytics-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'nested/episode.mp3'
	const filePath = path.join(rootPath, relativePath)

	mkdirSync(path.dirname(filePath), { recursive: true })
	await Bun.write(filePath, 'fake media bytes')

	Bun.env.MEDIA_PATHS = `${rootName}:${rootPath}`
	initEnv()

	const feedOne = createDirectoryFeed({
		name: `media analytics feed one ${Date.now()}`,
		directoryPaths: [`${rootName}:${rootPath}`],
	})
	const feedTwo = createDirectoryFeed({
		name: `media analytics feed two ${Date.now()}`,
		directoryPaths: [`${rootName}:${rootPath}`],
	})
	const tokenOne = createDirectoryFeedToken({
		feedId: feedOne.id,
		label: 'Token One',
	})
	const tokenTwo = createDirectoryFeedToken({
		feedId: feedTwo.id,
		label: 'Token Two',
	})

	return {
		rootName,
		rootPath,
		relativePath,
		feedOne,
		feedTwo,
		tokenOne,
		tokenTwo,
		[Symbol.asyncDispose]: async () => {
			db.query(
				sql`DELETE FROM feed_analytics_events WHERE feed_id IN (?, ?);`,
			).run(feedOne.id, feedTwo.id)
			deleteDirectoryFeed(feedOne.id)
			deleteDirectoryFeed(feedTwo.id)

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

function createActionContext(
	pathParam: string | undefined,
	days: number | string = 30,
): AnalyticsActionContext {
	const request = new Request(
		`http://localhost/admin/api/media-analytics/${encodeURIComponent(pathParam ?? '')}?days=${days}`,
	)

	return {
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { path: pathParam },
	} as unknown as AnalyticsActionContext
}

test('media analytics endpoint returns aggregate data across feeds and tokens', async () => {
	await using ctx = await createMediaApiTestContext()
	const now = Math.floor(Date.now() / 1000)
	const deletedToken = `deleted-token-${Date.now()}`

	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feedOne.id,
		feedType: 'directory',
		token: ctx.tokenOne.token,
		mediaRoot: ctx.rootName,
		relativePath: ctx.relativePath,
		isDownloadStart: true,
		bytesServed: 1000,
		statusCode: 200,
		clientFingerprint: 'fp-a',
		clientName: 'Pocket Casts',
		createdAt: now - 120,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feedTwo.id,
		feedType: 'directory',
		token: ctx.tokenTwo.token,
		mediaRoot: ctx.rootName,
		relativePath: ctx.relativePath,
		isDownloadStart: true,
		bytesServed: 600,
		statusCode: 206,
		clientFingerprint: 'fp-b',
		clientName: 'Apple Podcasts',
		createdAt: now - 90,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feedTwo.id,
		feedType: 'directory',
		token: ctx.tokenTwo.token,
		mediaRoot: ctx.rootName,
		relativePath: ctx.relativePath,
		isDownloadStart: false,
		bytesServed: 400,
		statusCode: 206,
		clientFingerprint: 'fp-b',
		clientName: 'Apple Podcasts',
		createdAt: now - 60,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feedOne.id,
		feedType: 'directory',
		token: ctx.tokenOne.token,
		mediaRoot: ctx.rootName,
		relativePath: ctx.relativePath,
		isDownloadStart: true,
		bytesServed: 9999,
		statusCode: 200,
		clientFingerprint: 'fp-a',
		clientName: 'Pocket Casts',
		createdAt: now - 400 * 24 * 60 * 60,
	})
	createFeedAnalyticsEvent({
		eventType: 'media_request',
		feedId: ctx.feedOne.id,
		feedType: 'directory',
		token: deletedToken,
		mediaRoot: ctx.rootName,
		relativePath: ctx.relativePath,
		isDownloadStart: true,
		bytesServed: 500,
		statusCode: 200,
		clientFingerprint: 'fp-c',
		clientName: 'AntennaPod',
		createdAt: now - 45,
	})

	const response = await analyticsHandler.action(
		createActionContext(`${ctx.rootName}/${ctx.relativePath}`),
	)
	expect(response.status).toBe(200)

	const data = await response.json()
	expect(data.media).toEqual({
		rootName: ctx.rootName,
		relativePath: ctx.relativePath,
	})
	expect(data.summary).toMatchObject({
		rssFetches: 0,
		mediaRequests: 4,
		downloadStarts: 3,
		bytesServed: 2500,
		uniqueClients: 3,
	})

	expect(data.byFeed).toHaveLength(2)
	const byFeedMap = new Map<string, (typeof data.byFeed)[number]>(
		data.byFeed.map((row: (typeof data.byFeed)[number]) => [row.feedId, row]),
	)
	expect(byFeedMap.get(ctx.feedOne.id)).toMatchObject({
		feedName: ctx.feedOne.name,
		mediaRequests: 2,
		downloadStarts: 2,
		bytesServed: 1500,
	})
	expect(byFeedMap.get(ctx.feedTwo.id)).toMatchObject({
		feedName: ctx.feedTwo.name,
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1000,
	})

	expect(data.byToken).toHaveLength(3)
	const byTokenMap = new Map<string, (typeof data.byToken)[number]>(
		data.byToken.map((row: (typeof data.byToken)[number]) => [row.token, row]),
	)
	expect(byTokenMap.get(ctx.tokenOne.token)).toMatchObject({
		label: 'Token One',
		feedName: ctx.feedOne.name,
		mediaRequests: 1,
		downloadStarts: 1,
		bytesServed: 1000,
	})
	expect(byTokenMap.get(ctx.tokenTwo.token)).toMatchObject({
		label: 'Token Two',
		feedName: ctx.feedTwo.name,
		mediaRequests: 2,
		downloadStarts: 1,
		bytesServed: 1000,
	})
	expect(byTokenMap.get(deletedToken)).toMatchObject({
		token: deletedToken,
		label: 'Deleted token',
		feedName: ctx.feedOne.name,
		createdAt: null,
		mediaRequests: 1,
		downloadStarts: 1,
		bytesServed: 500,
	})

	expect(data.topClients).toHaveLength(3)
	expect(
		data.topClients.some(
			(client: { clientName: string; mediaRequests: number }) =>
				client.clientName === 'Apple Podcasts' && client.mediaRequests === 2,
		),
	).toBe(true)
	expect(
		data.topClients.some(
			(client: { clientName: string; mediaRequests: number }) =>
				client.clientName === 'Pocket Casts' && client.mediaRequests === 1,
		),
	).toBe(true)
	expect(
		data.topClients.some(
			(client: { clientName: string; mediaRequests: number }) =>
				client.clientName === 'AntennaPod' && client.mediaRequests === 1,
		),
	).toBe(true)

	expect(data.daily.length).toBeGreaterThanOrEqual(1)
	expect(data.windowDays).toBe(30)
})

test('media analytics endpoint validates params and returns expected errors', async () => {
	await using ctx = await createMediaApiTestContext()

	const missingPathResponse = await analyticsHandler.action(
		createActionContext(undefined),
	)
	expect(missingPathResponse.status).toBe(400)
	expect(await missingPathResponse.json()).toEqual({ error: 'Path required' })

	const invalidFormatResponse = await analyticsHandler.action(
		createActionContext('invalid-format'),
	)
	expect(invalidFormatResponse.status).toBe(400)
	expect(await invalidFormatResponse.json()).toEqual({
		error: 'Invalid path format',
	})

	const unknownRootResponse = await analyticsHandler.action(
		createActionContext(`unknown-root/${ctx.relativePath}`),
	)
	expect(unknownRootResponse.status).toBe(404)
	expect(await unknownRootResponse.json()).toEqual({
		error: 'Unknown media root',
	})

	const missingFileResponse = await analyticsHandler.action(
		createActionContext(`${ctx.rootName}/missing.mp3`),
	)
	expect(missingFileResponse.status).toBe(404)
	expect(await missingFileResponse.json()).toEqual({ error: 'File not found' })
})

test('media analytics endpoint clamps analytics window days to max', async () => {
	await using ctx = await createMediaApiTestContext()

	const response = await analyticsHandler.action(
		createActionContext(`${ctx.rootName}/${ctx.relativePath}`, 9999),
	)
	expect(response.status).toBe(200)

	const data = await response.json()
	expect(data.windowDays).toBe(365)
})

test('media analytics endpoint defaults analytics window for invalid values', async () => {
	await using ctx = await createMediaApiTestContext()

	const invalidTextResponse = await analyticsHandler.action(
		createActionContext(`${ctx.rootName}/${ctx.relativePath}`, 'abc'),
	)
	expect(invalidTextResponse.status).toBe(200)

	const negativeResponse = await analyticsHandler.action(
		createActionContext(`${ctx.rootName}/${ctx.relativePath}`, -10),
	)
	expect(negativeResponse.status).toBe(200)

	const invalidTextData = await invalidTextResponse.json()
	const negativeData = await negativeResponse.json()
	expect(invalidTextData.windowDays).toBe(30)
	expect(negativeData.windowDays).toBe(30)
})
