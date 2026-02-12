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
	getFeedTopClientAnalytics,
	getFeedTopMediaItemAnalytics,
} from '#app/db/feed-analytics-events.ts'
import { parseAnalyticsWindowDays } from '#app/helpers/analytics-window.ts'

const TOP_ITEMS_LIMIT = 20

type TokenWithMetrics = {
	token: string
	label: string
	createdAt: number | null
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

type FeedTokenMetadata = {
	token: string
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
}

function buildTokenAnalytics(
	tokens: Array<FeedTokenMetadata>,
	tokenMetrics: ReturnType<typeof getFeedAnalyticsByToken>,
): Array<TokenWithMetrics> {
	const tokenMetadataByToken = new Map(
		tokens.map((token) => [token.token, token]),
	)
	const tokenMetricsByToken = new Map(
		tokenMetrics.map((metrics) => [metrics.token, metrics]),
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

	// Include historical analytics rows for tokens that have been deleted.
	for (const metrics of tokenMetrics) {
		if (tokenMetadataByToken.has(metrics.token)) continue
		byToken.push({
			token: metrics.token,
			label: 'Deleted token',
			createdAt: null,
			lastUsedAt: null,
			revokedAt: null,
			rssFetches: metrics.rssFetches,
			mediaRequests: metrics.mediaRequests,
			downloadStarts: metrics.downloadStarts,
			bytesServed: metrics.bytesServed,
			uniqueClients: metrics.uniqueClients,
			firstSeenAt: metrics.firstSeenAt,
			lastSeenAt: metrics.lastSeenAt,
		})
	}

	byToken.sort((a, b) => {
		if (b.downloadStarts !== a.downloadStarts) {
			return b.downloadStarts - a.downloadStarts
		}
		if (b.mediaRequests !== a.mediaRequests) {
			return b.mediaRequests - a.mediaRequests
		}
		return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
	})

	return byToken
}

/**
 * GET /admin/api/feeds/:id/analytics
 */
export default {
	middleware: [],
	action(context) {
		const { id } = context.params
		if (!id) {
			return Response.json({ error: 'Feed id required' }, { status: 400 })
		}
		const windowDays = parseAnalyticsWindowDays(context.request)
		const now = Math.floor(Date.now() / 1000)
		const since = now - windowDays * 24 * 60 * 60

		const directoryFeed = getDirectoryFeedById(id)
		let feedType: 'directory' | 'curated'
		let feed: { id: string; name: string }
		let tokens: Array<FeedTokenMetadata>

		if (directoryFeed) {
			feedType = 'directory'
			feed = directoryFeed
			tokens = listDirectoryFeedTokens(id)
		} else {
			const curatedFeed = getCuratedFeedById(id)
			if (!curatedFeed) {
				return Response.json({ error: 'Feed not found' }, { status: 404 })
			}

			feedType = 'curated'
			feed = curatedFeed
			tokens = listCuratedFeedTokens(id)
		}

		const summary = getFeedAnalyticsSummary(id, since)
		const tokenMetrics = getFeedAnalyticsByToken(id, since)
		const topMediaItems = getFeedTopMediaItemAnalytics(
			id,
			since,
			TOP_ITEMS_LIMIT,
		)
		const topClients = getFeedTopClientAnalytics(id, since, TOP_ITEMS_LIMIT)
		const daily = getFeedDailyAnalytics(id, since)
		const byToken = buildTokenAnalytics(tokens, tokenMetrics)

		return Response.json({
			feed: {
				id: feed.id,
				name: feed.name,
				type: feedType,
			},
			windowDays,
			since,
			summary,
			byToken,
			topMediaItems,
			topClients,
			daily,
		})
	},
} satisfies BuildAction<
	typeof routes.adminApiFeedAnalytics.method,
	typeof routes.adminApiFeedAnalytics.pattern
>
