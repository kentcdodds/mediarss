import { generateId } from '#app/helpers/crypto.ts'
import { createMediaKey, normalizePath } from '#app/helpers/path-parsing.ts'
import { type Database, lt, sql } from 'remix/data-table'
import { db } from './index.ts'
import { selectAll, selectOne } from './rows.ts'
import { feedAnalyticsEventsTable } from './schema.ts'
import { type AnalyticsEventType, type AnalyticsFeedType } from './types.ts'

export type CreateFeedAnalyticsEventData = {
	eventType: AnalyticsEventType
	feedId: string
	feedType: AnalyticsFeedType
	token: string
	mediaRoot?: string | null
	relativePath?: string | null
	isDownloadStart?: boolean
	bytesServed?: number | null
	statusCode: number
	clientFingerprint?: string | null
	clientName?: string | null
	createdAt?: number
}

export type AnalyticsSummary = {
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
}

export type TokenAnalyticsRow = AnalyticsSummary & {
	token: string
	firstSeenAt: number | null
	lastSeenAt: number | null
}

export type FeedTopMediaItemAnalyticsRow = {
	mediaRoot: string
	relativePath: string
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
	lastSeenAt: number | null
}

export type MediaPopularityMetrics = {
	mediaRoot: string
	relativePath: string
	mediaRequests: number
	downloadStarts: number
	uniqueClients: number
	lastSeenAt: number | null
}

export type DailyAnalyticsRow = AnalyticsSummary & {
	day: string
	dayStart: number
}

export type MediaByTokenAnalyticsRow = AnalyticsSummary & {
	token: string
	feedId: string
	feedType: AnalyticsFeedType
	firstSeenAt: number | null
	lastSeenAt: number | null
}

export type MediaByFeedAnalyticsRow = AnalyticsSummary & {
	feedId: string
	feedType: AnalyticsFeedType
	firstSeenAt: number | null
	lastSeenAt: number | null
}

export type TopClientAnalyticsRow = AnalyticsSummary & {
	clientName: string
	firstSeenAt: number | null
	lastSeenAt: number | null
}

function normalizeRelativePathForStorage(
	relativePath: string | null | undefined,
): string | null {
	if (!relativePath) return null
	const normalized = normalizePath(relativePath)
	return normalized || null
}

/**
 * Write a single analytics event.
 *
 * This should always be called in a best-effort flow from request handlers.
 */
export async function createFeedAnalyticsEvent(
	data: CreateFeedAnalyticsEventData,
	database: Database = db,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000)

	await database.create(feedAnalyticsEventsTable, {
		id: generateId(),
		event_type: data.eventType,
		feed_id: data.feedId,
		feed_type: data.feedType,
		token: data.token,
		media_root: data.mediaRoot ?? null,
		relative_path: normalizeRelativePathForStorage(data.relativePath),
		is_download_start: data.isDownloadStart ? 1 : 0,
		bytes_served: data.bytesServed ?? null,
		status_code: data.statusCode,
		client_fingerprint: data.clientFingerprint ?? null,
		client_name: data.clientName ?? null,
		created_at: data.createdAt ?? now,
	})
}

/**
 * Delete analytics events older than the given unix timestamp.
 */
export async function pruneFeedAnalyticsEvents(
	olderThan: number,
	database: Database = db,
): Promise<number> {
	const result = await database.deleteMany(feedAnalyticsEventsTable, {
		where: lt('created_at', olderThan),
	})
	return result.affectedRows
}

function mapAnalyticsSummaryRow(
	row:
		| {
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
		  }
		| null
		| undefined,
): AnalyticsSummary {
	return {
		rssFetches: row?.rss_fetches ?? 0,
		mediaRequests: row?.media_requests ?? 0,
		downloadStarts: row?.download_starts ?? 0,
		bytesServed: row?.bytes_served ?? 0,
		uniqueClients: row?.unique_clients ?? 0,
	}
}

/**
 * Summary for a single feed, across all tokens.
 */
export async function getFeedAnalyticsSummary(
	feedId: string,
	since: number,
	database: Database = db,
): Promise<AnalyticsSummary> {
	const row = await selectOne<{
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
	}>(
		database,
		sql`
			SELECT
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
			FROM feed_analytics_events
			WHERE feed_id = ${feedId} AND created_at >= ${since};
		`,
	)

	return mapAnalyticsSummaryRow(row)
}

/**
 * Per-token analytics for a feed.
 */
export async function getFeedAnalyticsByToken(
	feedId: string,
	since: number,
	database: Database = db,
): Promise<Array<TokenAnalyticsRow>> {
	const rows = await selectAll<{
		token: string
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		first_seen_at: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				token,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MIN(created_at) AS first_seen_at,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE feed_id = ${feedId} AND created_at >= ${since}
			GROUP BY token
			ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
		`,
	)

	return rows.map((row) => ({
		token: row.token,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
	}))
}

/**
 * Top media items for a feed in the requested time window.
 */
export async function getFeedTopMediaItemAnalytics(
	feedId: string,
	since: number,
	limit = 10,
	database: Database = db,
): Promise<Array<FeedTopMediaItemAnalyticsRow>> {
	const rows = await selectAll<{
		media_root: string
		relative_path: string
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				media_root,
				relative_path,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE
				feed_id = ${feedId}
				AND created_at >= ${since}
				AND media_root IS NOT NULL
				AND relative_path IS NOT NULL
			GROUP BY media_root, relative_path
			HAVING SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END) > 0
			ORDER BY download_starts DESC, bytes_served DESC, media_requests DESC
			LIMIT ${limit};
		`,
	)

	return rows.map((row) => ({
		mediaRoot: row.media_root,
		relativePath: row.relative_path,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		lastSeenAt: row.last_seen_at,
	}))
}

/**
 * Aggregate popularity metrics for all media items across all feeds/tokens.
 */
export async function listMediaPopularityMetrics(
	database: Database = db,
): Promise<Map<string, MediaPopularityMetrics>> {
	const rows = await selectAll<{
		media_root: string
		relative_path: string
		media_requests: number | null
		download_starts: number | null
		unique_clients: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				media_root,
				relative_path,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE media_root IS NOT NULL AND relative_path IS NOT NULL
			GROUP BY media_root, relative_path
			HAVING SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END) > 0
			ORDER BY download_starts DESC, media_requests DESC, unique_clients DESC, last_seen_at DESC;
		`,
	)

	return new Map(
		rows.map((row) => {
			const metrics: MediaPopularityMetrics = {
				mediaRoot: row.media_root,
				relativePath: row.relative_path,
				mediaRequests: row.media_requests ?? 0,
				downloadStarts: row.download_starts ?? 0,
				uniqueClients: row.unique_clients ?? 0,
				lastSeenAt: row.last_seen_at,
			}
			return [
				createMediaKey(row.media_root, row.relative_path),
				metrics,
			] as const
		}),
	)
}

/**
 * Daily analytics points for a feed.
 */
export async function getFeedDailyAnalytics(
	feedId: string,
	since: number,
	database: Database = db,
): Promise<Array<DailyAnalyticsRow>> {
	const rows = await selectAll<{
		day: string
		day_start: number
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
	}>(
		database,
		sql`
			SELECT
				strftime('%Y-%m-%d', created_at, 'unixepoch') AS day,
				CAST(strftime('%s', date(created_at, 'unixepoch')) AS INTEGER) AS day_start,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
			FROM feed_analytics_events
			WHERE feed_id = ${feedId} AND created_at >= ${since}
			GROUP BY day
			ORDER BY day ASC;
		`,
	)

	return rows.map((row) => ({
		day: row.day,
		dayStart: row.day_start,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
	}))
}

/**
 * Top client applications for a feed.
 */
export async function getFeedTopClientAnalytics(
	feedId: string,
	since: number,
	limit = 10,
	database: Database = db,
): Promise<Array<TopClientAnalyticsRow>> {
	const rows = await selectAll<{
		client_name: string
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		first_seen_at: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				COALESCE(client_name, 'Unknown') AS client_name,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MIN(created_at) AS first_seen_at,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE feed_id = ${feedId} AND created_at >= ${since}
			GROUP BY COALESCE(client_name, 'Unknown')
			ORDER BY media_requests DESC, rss_fetches DESC, download_starts DESC
			LIMIT ${limit};
		`,
	)

	return rows.map((row) => ({
		clientName: row.client_name,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
	}))
}

/**
 * Summary analytics for a specific media item across all feeds/tokens.
 */
export async function getMediaAnalyticsSummary(
	mediaRoot: string,
	relativePath: string,
	since: number,
	database: Database = db,
): Promise<AnalyticsSummary> {
	const normalizedRelativePath = normalizePath(relativePath)
	const row = await selectOne<{
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
	}>(
		database,
		sql`
			SELECT
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
			FROM feed_analytics_events
			WHERE media_root = ${mediaRoot} AND relative_path = ${normalizedRelativePath} AND created_at >= ${since};
		`,
	)

	return mapAnalyticsSummaryRow(row)
}

/**
 * Media analytics grouped by token (keeps feed id/type for context).
 */
export async function getMediaAnalyticsByToken(
	mediaRoot: string,
	relativePath: string,
	since: number,
	database: Database = db,
): Promise<Array<MediaByTokenAnalyticsRow>> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = await selectAll<{
		token: string
		feed_id: string
		feed_type: AnalyticsFeedType
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		first_seen_at: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				token,
				feed_id,
				feed_type,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MIN(created_at) AS first_seen_at,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE media_root = ${mediaRoot} AND relative_path = ${normalizedRelativePath} AND created_at >= ${since}
			GROUP BY token, feed_id, feed_type
			ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
		`,
	)

	return rows.map((row) => ({
		token: row.token,
		feedId: row.feed_id,
		feedType: row.feed_type,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
	}))
}

/**
 * Media analytics grouped by feed.
 */
export async function getMediaAnalyticsByFeed(
	mediaRoot: string,
	relativePath: string,
	since: number,
	database: Database = db,
): Promise<Array<MediaByFeedAnalyticsRow>> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = await selectAll<{
		feed_id: string
		feed_type: AnalyticsFeedType
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		first_seen_at: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				feed_id,
				feed_type,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MIN(created_at) AS first_seen_at,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE media_root = ${mediaRoot} AND relative_path = ${normalizedRelativePath} AND created_at >= ${since}
			GROUP BY feed_id, feed_type
			ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
		`,
	)

	return rows.map((row) => ({
		feedId: row.feed_id,
		feedType: row.feed_type,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
	}))
}

/**
 * Daily analytics points for a specific media item.
 */
export async function getMediaDailyAnalytics(
	mediaRoot: string,
	relativePath: string,
	since: number,
	database: Database = db,
): Promise<Array<DailyAnalyticsRow>> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = await selectAll<{
		day: string
		day_start: number
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
	}>(
		database,
		sql`
			SELECT
				strftime('%Y-%m-%d', created_at, 'unixepoch') AS day,
				CAST(strftime('%s', date(created_at, 'unixepoch')) AS INTEGER) AS day_start,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
			FROM feed_analytics_events
			WHERE media_root = ${mediaRoot} AND relative_path = ${normalizedRelativePath} AND created_at >= ${since}
			GROUP BY day
			ORDER BY day ASC;
		`,
	)

	return rows.map((row) => ({
		day: row.day,
		dayStart: row.day_start,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
	}))
}

/**
 * Top client applications for a specific media item.
 */
export async function getMediaTopClientAnalytics(
	mediaRoot: string,
	relativePath: string,
	since: number,
	limit = 10,
	database: Database = db,
): Promise<Array<TopClientAnalyticsRow>> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = await selectAll<{
		client_name: string
		rss_fetches: number | null
		media_requests: number | null
		download_starts: number | null
		bytes_served: number | null
		unique_clients: number | null
		first_seen_at: number | null
		last_seen_at: number | null
	}>(
		database,
		sql`
			SELECT
				COALESCE(client_name, 'Unknown') AS client_name,
				COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
				COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
				COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients,
				MIN(created_at) AS first_seen_at,
				MAX(created_at) AS last_seen_at
			FROM feed_analytics_events
			WHERE media_root = ${mediaRoot} AND relative_path = ${normalizedRelativePath} AND created_at >= ${since}
			GROUP BY COALESCE(client_name, 'Unknown')
			ORDER BY media_requests DESC, download_starts DESC, rss_fetches DESC
			LIMIT ${limit};
		`,
	)

	return rows.map((row) => ({
		clientName: row.client_name,
		rssFetches: row.rss_fetches ?? 0,
		mediaRequests: row.media_requests ?? 0,
		downloadStarts: row.download_starts ?? 0,
		bytesServed: row.bytes_served ?? 0,
		uniqueClients: row.unique_clients ?? 0,
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
	}))
}
