import type { BuildAction } from 'remix/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import { listDirectoryFeeds } from '#app/db/directory-feeds.ts'
import {
	getMediaAnalyticsByFeed,
	getMediaAnalyticsByToken,
	getMediaAnalyticsSummary,
	getMediaDailyAnalytics,
	getMediaTopClientAnalytics,
} from '#app/db/feed-analytics-events.ts'
import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365

function parseWindowDays(request: Request): number {
	const { searchParams } = new URL(request.url)
	const requested = Number.parseInt(
		searchParams.get('days') ?? `${DEFAULT_WINDOW_DAYS}`,
		10,
	)
	if (!Number.isFinite(requested) || requested <= 0) {
		return DEFAULT_WINDOW_DAYS
	}
	return Math.min(requested, MAX_WINDOW_DAYS)
}

function getTokenMetadata(
	token: string,
	feedType: 'directory' | 'curated',
): {
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
} | null {
	if (feedType === 'directory') {
		const row = db
			.query<
				{
					label: string
					created_at: number
					last_used_at: number | null
					revoked_at: number | null
				},
				[string]
			>(
				sql`
					SELECT label, created_at, last_used_at, revoked_at
					FROM directory_feed_tokens
					WHERE token = ?;
				`,
			)
			.get(token)
		if (!row) return null
		return {
			label: row.label,
			createdAt: row.created_at,
			lastUsedAt: row.last_used_at,
			revokedAt: row.revoked_at,
		}
	}

	const row = db
		.query<
			{
				label: string
				created_at: number
				last_used_at: number | null
				revoked_at: number | null
			},
			[string]
		>(
			sql`
				SELECT label, created_at, last_used_at, revoked_at
				FROM curated_feed_tokens
				WHERE token = ?;
			`,
		)
		.get(token)
	if (!row) return null
	return {
		label: row.label,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
	}
}

/**
 * GET /admin/api/media-analytics/*path
 */
export default {
	middleware: [],
	async action(context) {
		const { path: splatParam } = context.params
		if (!splatParam) {
			return Response.json({ error: 'Path required' }, { status: 400 })
		}

		const decodedPath = decodeURIComponent(splatParam)
		const parsed = parseMediaPathStrict(decodedPath)
		if (!parsed) {
			return Response.json({ error: 'Invalid path format' }, { status: 400 })
		}

		const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
		if (!filePath) {
			return Response.json({ error: 'Unknown media root' }, { status: 404 })
		}

		const file = Bun.file(filePath)
		if (!(await file.exists())) {
			return Response.json({ error: 'File not found' }, { status: 404 })
		}

		const windowDays = parseWindowDays(context.request)
		const now = Math.floor(Date.now() / 1000)
		const since = now - windowDays * 24 * 60 * 60

		const summary = getMediaAnalyticsSummary(
			parsed.rootName,
			parsed.relativePath,
			since,
		)
		const byToken = getMediaAnalyticsByToken(
			parsed.rootName,
			parsed.relativePath,
			since,
		)
		const byFeed = getMediaAnalyticsByFeed(
			parsed.rootName,
			parsed.relativePath,
			since,
		)
		const daily = getMediaDailyAnalytics(
			parsed.rootName,
			parsed.relativePath,
			since,
		)
		const topClients = getMediaTopClientAnalytics(
			parsed.rootName,
			parsed.relativePath,
			since,
		)

		const curatedFeeds = listCuratedFeeds()
		const directoryFeeds = listDirectoryFeeds()
		const feedNameById = new Map<string, string>()
		for (const feed of curatedFeeds) {
			feedNameById.set(feed.id, feed.name)
		}
		for (const feed of directoryFeeds) {
			feedNameById.set(feed.id, feed.name)
		}

		const byFeedWithNames = byFeed.map((row) => ({
			...row,
			feedName: feedNameById.get(row.feedId) ?? 'Deleted feed',
		}))

		const byTokenWithMetadata = byToken.map((row) => {
			const tokenMeta = getTokenMetadata(row.token, row.feedType)
			return {
				...row,
				feedName: feedNameById.get(row.feedId) ?? 'Deleted feed',
				label: tokenMeta?.label ?? 'Deleted token',
				createdAt: tokenMeta?.createdAt ?? null,
				lastUsedAt: tokenMeta?.lastUsedAt ?? null,
				revokedAt: tokenMeta?.revokedAt ?? null,
			}
		})

		return Response.json({
			media: {
				rootName: parsed.rootName,
				relativePath: parsed.relativePath,
			},
			windowDays,
			since,
			summary,
			byToken: byTokenWithMetadata,
			byFeed: byFeedWithNames,
			topClients,
			daily,
		})
	},
} satisfies BuildAction<
	typeof routes.adminApiMediaAnalytics.method,
	typeof routes.adminApiMediaAnalytics.pattern
>
