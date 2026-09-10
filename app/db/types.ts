import { type TableRow } from 'remix/data-table'
import { type CamelCaseRow } from './rows.ts'
import {
	type curatedFeedsTable,
	type curatedFeedTokensTable,
	type directoryFeedsTable,
	type directoryFeedTokensTable,
	type feedAnalyticsEventsTable,
	type feedItemsTable,
} from './schema.ts'

export type DirectoryFeed = CamelCaseRow<TableRow<typeof directoryFeedsTable>>
export type CuratedFeed = CamelCaseRow<TableRow<typeof curatedFeedsTable>>
export type FeedItem = CamelCaseRow<TableRow<typeof feedItemsTable>>

export type SortOrder = DirectoryFeed['sortOrder']
export type FeedType = NonNullable<DirectoryFeed['feedType']>

type FeedAnalyticsEvent = CamelCaseRow<
	TableRow<typeof feedAnalyticsEventsTable>
>
export type AnalyticsEventType = FeedAnalyticsEvent['eventType']
export type AnalyticsFeedType = FeedAnalyticsEvent['feedType']

/**
 * Token for accessing a directory feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export type DirectoryFeedToken = CamelCaseRow<
	TableRow<typeof directoryFeedTokensTable>
>

/**
 * Token for accessing a curated feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export type CuratedFeedToken = CamelCaseRow<
	TableRow<typeof curatedFeedTokensTable>
>

export type Feed = DirectoryFeed | CuratedFeed

export type FeedToken = DirectoryFeedToken | CuratedFeedToken

/**
 * Type guard to check if a feed is a DirectoryFeed
 */
export function isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPaths' in feed
}

/**
 * Type guard to check if a feed is a CuratedFeed
 */
export function isCuratedFeed(feed: Feed): feed is CuratedFeed {
	return !('directoryPaths' in feed)
}
