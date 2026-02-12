import type { BuildAction } from 'remix/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import {
	getMediaAnalyticsByFeed,
	getMediaAnalyticsByToken,
	getMediaAnalyticsSummary,
	getMediaDailyAnalytics,
	getMediaTopClientAnalytics,
} from '#app/db/feed-analytics-events.ts'
import { db } from '#app/db/index.ts'
import { sql } from '#app/db/sql.ts'
import { parseAnalyticsWindowDays } from '#app/helpers/analytics-window.ts'
import { decodePathParam } from '#app/helpers/decode-path-param.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'

type FeedType = 'directory' | 'curated'
type TokenTableName = 'directory_feed_tokens' | 'curated_feed_tokens'
type FeedTableName = 'directory_feeds' | 'curated_feeds'

type TokenMetadata = {
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
}

function listTokenMetadataByFeedIdsFromTable(
	tableName: TokenTableName,
	feedType: FeedType,
	feedIds: Array<string>,
): Map<string, TokenMetadata> {
	if (feedIds.length === 0) {
		return new Map()
	}

	const placeholders = feedIds.map(() => '?').join(', ')
	const rows = db
		.query<
			{
				token: string
				feed_id: string
				label: string
				created_at: number
				last_used_at: number | null
				revoked_at: number | null
			},
			Array<string>
		>(
			sql`
				SELECT token, feed_id, label, created_at, last_used_at, revoked_at
				FROM ${tableName}
				WHERE feed_id IN (${placeholders});
			`,
		)
		.all(...feedIds)

	return new Map(
		rows.map((row) => [
			getFeedTokenKey(feedType, row.feed_id, row.token),
			{
				label: row.label,
				createdAt: row.created_at,
				lastUsedAt: row.last_used_at,
				revokedAt: row.revoked_at,
			},
		]),
	)
}

function listTokenMetadataByFeedIds(
	feedType: FeedType,
	feedIds: Array<string>,
): Map<string, TokenMetadata> {
	const tableName: TokenTableName =
		feedType === 'directory' ? 'directory_feed_tokens' : 'curated_feed_tokens'
	return listTokenMetadataByFeedIdsFromTable(tableName, feedType, feedIds)
}

function listFeedNamesByIds(
	tableName: FeedTableName,
	feedIds: Array<string>,
): Map<string, string> {
	if (feedIds.length === 0) {
		return new Map()
	}

	const placeholders = feedIds.map(() => '?').join(', ')
	const rows = db
		.query<{ id: string; name: string }, Array<string>>(
			sql`
				SELECT id, name
				FROM ${tableName}
				WHERE id IN (${placeholders});
			`,
		)
		.all(...feedIds)

	return new Map(rows.map((row) => [row.id, row.name]))
}

function getFeedKey(feedType: FeedType, feedId: string): string {
	return `${feedType}:${feedId}`
}

function getFeedTokenKey(
	feedType: FeedType,
	feedId: string,
	token: string,
): string {
	return `${feedType}:${feedId}:${token}`
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

		const decodedPath = decodePathParam(splatParam)
		if (decodedPath === null) {
			return Response.json({ error: 'Invalid path encoding' }, { status: 400 })
		}
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

		const windowDays = parseAnalyticsWindowDays(context.request)
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

		const directoryFeedIds = new Set<string>()
		const curatedFeedIds = new Set<string>()
		for (const row of byFeed) {
			if (row.feedType === 'directory') {
				directoryFeedIds.add(row.feedId)
			} else {
				curatedFeedIds.add(row.feedId)
			}
		}
		for (const row of byToken) {
			if (row.feedType === 'directory') {
				directoryFeedIds.add(row.feedId)
			} else {
				curatedFeedIds.add(row.feedId)
			}
		}

		const directoryFeedIdList = Array.from(directoryFeedIds)
		const curatedFeedIdList = Array.from(curatedFeedIds)

		const directoryFeedNameById = listFeedNamesByIds(
			'directory_feeds',
			directoryFeedIdList,
		)
		const curatedFeedNameById = listFeedNamesByIds(
			'curated_feeds',
			curatedFeedIdList,
		)
		const feedNameByKey = new Map<string, string>()
		for (const [feedId, feedName] of directoryFeedNameById.entries()) {
			feedNameByKey.set(getFeedKey('directory', feedId), feedName)
		}
		for (const [feedId, feedName] of curatedFeedNameById.entries()) {
			feedNameByKey.set(getFeedKey('curated', feedId), feedName)
		}

		const tokenMetadataByKey = new Map<string, TokenMetadata>()
		for (const [tokenKey, tokenMetadata] of listTokenMetadataByFeedIds(
			'directory',
			directoryFeedIdList,
		).entries()) {
			tokenMetadataByKey.set(tokenKey, tokenMetadata)
		}
		for (const [tokenKey, tokenMetadata] of listTokenMetadataByFeedIds(
			'curated',
			curatedFeedIdList,
		).entries()) {
			tokenMetadataByKey.set(tokenKey, tokenMetadata)
		}

		const byFeedWithNames = byFeed.map((row) => ({
			...row,
			feedName:
				feedNameByKey.get(getFeedKey(row.feedType, row.feedId)) ??
				'Deleted feed',
		}))

		const byTokenWithMetadata = byToken.map((row) => {
			const tokenMeta = tokenMetadataByKey.get(
				getFeedTokenKey(row.feedType, row.feedId, row.token),
			)
			return {
				...row,
				feedName:
					feedNameByKey.get(getFeedKey(row.feedType, row.feedId)) ??
					'Deleted feed',
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
