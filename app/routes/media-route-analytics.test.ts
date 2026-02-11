import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import mediaHandler from './media.ts'

migrate(db)

type MediaActionContext = Parameters<typeof mediaHandler.action>[0]

async function createMediaAnalyticsTestContext() {
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

test('media route logs media_request analytics for full and ranged requests', async () => {
	await using ctx = await createMediaAnalyticsTestContext()
	const pathParam = `${ctx.rootName}/${ctx.relativePath}`

	const fullResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam),
	)
	expect(fullResponse.status).toBe(200)

	const rangedResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
			Range: 'bytes=10-',
		}),
	)
	expect(rangedResponse.status).toBe(206)

	const rangeFromStartResponse = await mediaHandler.action(
		createMediaActionContext(ctx.token, pathParam, {
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
			},
			[string]
		>(
			sql`
				SELECT status_code, is_download_start, bytes_served, media_root, relative_path
				FROM feed_analytics_events
				WHERE feed_id = ? AND event_type = 'media_request'
				ORDER BY created_at ASC, id ASC;
			`,
		)
		.all(ctx.feed.id)

	expect(events).toHaveLength(3)
	expect(events[0]).toMatchObject({
		status_code: 200,
		is_download_start: 1,
		media_root: ctx.rootName,
		relative_path: ctx.relativePath,
	})
	expect((events[0]?.bytes_served ?? 0) > 0).toBe(true)

	expect(events[1]).toMatchObject({
		status_code: 206,
		is_download_start: 0,
		media_root: ctx.rootName,
		relative_path: ctx.relativePath,
	})
	expect((events[1]?.bytes_served ?? 0) > 0).toBe(true)

	expect(events[2]).toMatchObject({
		status_code: 206,
		is_download_start: 1,
		media_root: ctx.rootName,
		relative_path: ctx.relativePath,
	})
	expect((events[2]?.bytes_served ?? 0) > 0).toBe(true)
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
