import { generateId } from '#app/helpers/crypto.ts'
import { normalizePath } from '#app/helpers/path-parsing.ts'
import { db } from './index.ts'
import { sql } from './sql.ts'
import type { AnalyticsEventType, AnalyticsFeedType } from './types.ts'

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
export function createFeedAnalyticsEvent(
	data: CreateFeedAnalyticsEventData,
): void {
	const now = Math.floor(Date.now() / 1000)

	db.query(
		sql`
			INSERT INTO feed_analytics_events (
				id,
				event_type,
				feed_id,
				feed_type,
				token,
				media_root,
				relative_path,
				is_download_start,
				bytes_served,
				status_code,
				client_fingerprint,
				client_name,
				created_at
			)
			VALUES (
				$id,
				$eventType,
				$feedId,
				$feedType,
				$token,
				$mediaRoot,
				$relativePath,
				$isDownloadStart,
				$bytesServed,
				$statusCode,
				$clientFingerprint,
				$clientName,
				$createdAt
			);
		`,
	).run({
		$id: generateId(),
		$eventType: data.eventType,
		$feedId: data.feedId,
		$feedType: data.feedType,
		$token: data.token,
		$mediaRoot: data.mediaRoot ?? null,
		$relativePath: normalizeRelativePathForStorage(data.relativePath),
		$isDownloadStart: data.isDownloadStart ? 1 : 0,
		$bytesServed: data.bytesServed ?? null,
		$statusCode: data.statusCode,
		$clientFingerprint: data.clientFingerprint ?? null,
		$clientName: data.clientName ?? null,
		$createdAt: data.createdAt ?? now,
	})
}

/**
 * Delete analytics events older than the given unix timestamp.
 */
export function pruneFeedAnalyticsEvents(olderThan: number): number {
	const result = db
		.query(sql`DELETE FROM feed_analytics_events WHERE created_at < ?;`)
		.run(olderThan)
	return result.changes
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
export function getFeedAnalyticsSummary(
	feedId: string,
	since: number,
): AnalyticsSummary {
	const row = db
		.query<
			{
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
			},
			[string, number]
		>(
			sql`
				SELECT
					COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
					COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
				FROM feed_analytics_events
				WHERE feed_id = ? AND created_at >= ?;
			`,
		)
		.get(feedId, since)

	return mapAnalyticsSummaryRow(row)
}

/**
 * Per-token analytics for a feed.
 */
export function getFeedAnalyticsByToken(
	feedId: string,
	since: number,
): Array<TokenAnalyticsRow> {
	const rows = db
		.query<
			{
				token: string
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
				first_seen_at: number | null
				last_seen_at: number | null
			},
			[string, number]
		>(
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
				WHERE feed_id = ? AND created_at >= ?
				GROUP BY token
				ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
			`,
		)
		.all(feedId, since)

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
export function getFeedTopMediaItemAnalytics(
	feedId: string,
	since: number,
	limit = 10,
): Array<FeedTopMediaItemAnalyticsRow> {
	const rows = db
		.query<
			{
				media_root: string
				relative_path: string
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
				last_seen_at: number | null
			},
			[string, number, number]
		>(
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
					feed_id = ?
					AND created_at >= ?
					AND media_root IS NOT NULL
					AND relative_path IS NOT NULL
				GROUP BY media_root, relative_path
				HAVING SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END) > 0
				ORDER BY download_starts DESC, bytes_served DESC, media_requests DESC
				LIMIT ?;
			`,
		)
		.all(feedId, since, limit)

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
 * Daily analytics points for a feed.
 */
export function getFeedDailyAnalytics(
	feedId: string,
	since: number,
): Array<DailyAnalyticsRow> {
	const rows = db
		.query<
			{
				day: string
				day_start: number
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
			},
			[string, number]
		>(
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
				WHERE feed_id = ? AND created_at >= ?
				GROUP BY day
				ORDER BY day ASC;
			`,
		)
		.all(feedId, since)

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
 * Summary analytics for a specific media item across all feeds/tokens.
 */
export function getMediaAnalyticsSummary(
	mediaRoot: string,
	relativePath: string,
	since: number,
): AnalyticsSummary {
	const normalizedRelativePath = normalizePath(relativePath)
	const row = db
		.query<
			{
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
			},
			[string, string, number]
		>(
			sql`
				SELECT
					COALESCE(SUM(CASE WHEN event_type = 'rss_fetch' THEN 1 ELSE 0 END), 0) AS rss_fetches,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN 1 ELSE 0 END), 0) AS media_requests,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' AND is_download_start = 1 THEN 1 ELSE 0 END), 0) AS download_starts,
					COALESCE(SUM(CASE WHEN event_type = 'media_request' THEN COALESCE(bytes_served, 0) ELSE 0 END), 0) AS bytes_served,
					COALESCE(COUNT(DISTINCT CASE WHEN client_fingerprint IS NOT NULL THEN client_fingerprint END), 0) AS unique_clients
				FROM feed_analytics_events
				WHERE media_root = ? AND relative_path = ? AND created_at >= ?;
			`,
		)
		.get(mediaRoot, normalizedRelativePath, since)

	return mapAnalyticsSummaryRow(row)
}

/**
 * Media analytics grouped by token (keeps feed id/type for context).
 */
export function getMediaAnalyticsByToken(
	mediaRoot: string,
	relativePath: string,
	since: number,
): Array<MediaByTokenAnalyticsRow> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = db
		.query<
			{
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
			},
			[string, string, number]
		>(
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
				WHERE media_root = ? AND relative_path = ? AND created_at >= ?
				GROUP BY token, feed_id, feed_type
				ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
			`,
		)
		.all(mediaRoot, normalizedRelativePath, since)

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
export function getMediaAnalyticsByFeed(
	mediaRoot: string,
	relativePath: string,
	since: number,
): Array<MediaByFeedAnalyticsRow> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = db
		.query<
			{
				feed_id: string
				feed_type: AnalyticsFeedType
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
				first_seen_at: number | null
				last_seen_at: number | null
			},
			[string, string, number]
		>(
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
				WHERE media_root = ? AND relative_path = ? AND created_at >= ?
				GROUP BY feed_id, feed_type
				ORDER BY download_starts DESC, media_requests DESC, last_seen_at DESC;
			`,
		)
		.all(mediaRoot, normalizedRelativePath, since)

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
export function getMediaDailyAnalytics(
	mediaRoot: string,
	relativePath: string,
	since: number,
): Array<DailyAnalyticsRow> {
	const normalizedRelativePath = normalizePath(relativePath)
	const rows = db
		.query<
			{
				day: string
				day_start: number
				rss_fetches: number | null
				media_requests: number | null
				download_starts: number | null
				bytes_served: number | null
				unique_clients: number | null
			},
			[string, string, number]
		>(
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
				WHERE media_root = ? AND relative_path = ? AND created_at >= ?
				GROUP BY day
				ORDER BY day ASC;
			`,
		)
		.all(mediaRoot, normalizedRelativePath, since)

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
