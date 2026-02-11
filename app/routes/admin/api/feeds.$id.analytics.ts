import type { BuildAction } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { listCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import { listDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import { getDirectoryFeedById } from '#app/db/directory-feeds.ts'
import {
	getFeedAnalyticsByToken,
	getFeedAnalyticsSummary,
	getFeedDailyAnalytics,
	getFeedTopMediaItemAnalytics,
} from '#app/db/feed-analytics-events.ts'

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365
const TOP_ITEMS_LIMIT = 20

type TokenWithMetrics = {
	token: string
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
	firstSeenAt: number | null
	lastSeenAt: number | null
}

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

/**
 * GET /admin/api/feeds/:id/analytics
 */
export default {
	middleware: [],
	action(context) {
		const { id } = context.params
		const windowDays = parseWindowDays(context.request)
		const now = Math.floor(Date.now() / 1000)
		const since = now - windowDays * 24 * 60 * 60

		const directoryFeed = getDirectoryFeedById(id)
		if (directoryFeed) {
			const summary = getFeedAnalyticsSummary(id, since)
			const tokenMetrics = getFeedAnalyticsByToken(id, since)
			const topMediaItems = getFeedTopMediaItemAnalytics(
				id,
				since,
				TOP_ITEMS_LIMIT,
			)
			const daily = getFeedDailyAnalytics(id, since)
			const tokens = listDirectoryFeedTokens(id)
			const tokenMetricsByToken = new Map(
				tokenMetrics.map((row) => [row.token, row]),
			)

			const byToken: Array<TokenWithMetrics> = tokens.map((token) => {
				const metrics = tokenMetricsByToken.get(token.token)
				return {
					token: token.token,
					label: token.label,
					createdAt: token.createdAt,
					lastUsedAt: token.lastUsedAt,
					revokedAt: token.revokedAt,
					rssFetches: metrics?.rssFetches ?? 0,
					mediaRequests: metrics?.mediaRequests ?? 0,
					downloadStarts: metrics?.downloadStarts ?? 0,
					bytesServed: metrics?.bytesServed ?? 0,
					uniqueClients: metrics?.uniqueClients ?? 0,
					firstSeenAt: metrics?.firstSeenAt ?? null,
					lastSeenAt: metrics?.lastSeenAt ?? null,
				}
			})

			byToken.sort((a, b) => {
				if (b.downloadStarts !== a.downloadStarts) {
					return b.downloadStarts - a.downloadStarts
				}
				if (b.mediaRequests !== a.mediaRequests) {
					return b.mediaRequests - a.mediaRequests
				}
				return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
			})

			return Response.json({
				feed: {
					id: directoryFeed.id,
					name: directoryFeed.name,
					type: 'directory' as const,
				},
				windowDays,
				since,
				summary,
				byToken,
				topMediaItems,
				daily,
			})
		}

		const curatedFeed = getCuratedFeedById(id)
		if (curatedFeed) {
			const summary = getFeedAnalyticsSummary(id, since)
			const tokenMetrics = getFeedAnalyticsByToken(id, since)
			const topMediaItems = getFeedTopMediaItemAnalytics(
				id,
				since,
				TOP_ITEMS_LIMIT,
			)
			const daily = getFeedDailyAnalytics(id, since)
			const tokens = listCuratedFeedTokens(id)
			const tokenMetricsByToken = new Map(
				tokenMetrics.map((row) => [row.token, row]),
			)

			const byToken: Array<TokenWithMetrics> = tokens.map((token) => {
				const metrics = tokenMetricsByToken.get(token.token)
				return {
					token: token.token,
					label: token.label,
					createdAt: token.createdAt,
					lastUsedAt: token.lastUsedAt,
					revokedAt: token.revokedAt,
					rssFetches: metrics?.rssFetches ?? 0,
					mediaRequests: metrics?.mediaRequests ?? 0,
					downloadStarts: metrics?.downloadStarts ?? 0,
					bytesServed: metrics?.bytesServed ?? 0,
					uniqueClients: metrics?.uniqueClients ?? 0,
					firstSeenAt: metrics?.firstSeenAt ?? null,
					lastSeenAt: metrics?.lastSeenAt ?? null,
				}
			})

			byToken.sort((a, b) => {
				if (b.downloadStarts !== a.downloadStarts) {
					return b.downloadStarts - a.downloadStarts
				}
				if (b.mediaRequests !== a.mediaRequests) {
					return b.mediaRequests - a.mediaRequests
				}
				return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
			})

			return Response.json({
				feed: {
					id: curatedFeed.id,
					name: curatedFeed.name,
					type: 'curated' as const,
				},
				windowDays,
				since,
				summary,
				byToken,
				topMediaItems,
				daily,
			})
		}

		return Response.json({ error: 'Feed not found' }, { status: 404 })
	},
} satisfies BuildAction<
	typeof routes.adminApiFeedAnalytics.method,
	typeof routes.adminApiFeedAnalytics.pattern
>
