import {
	enum_,
	type InferOutput,
	nullable,
	number,
	object,
	string,
	union,
} from 'remix/data-schema'

export const SortOrderSchema = enum_(['asc', 'desc'] as const)
export type SortOrder = InferOutput<typeof SortOrderSchema>

export const FeedTypeSchema = enum_(['episodic', 'serial'] as const)
export type FeedType = InferOutput<typeof FeedTypeSchema>

export const DirectoryFeedSchema = object({
	id: string(),
	name: string(),
	description: string(),
	subtitle: nullable(string()),
	directoryPaths: string(), // JSON array of "mediaRoot:relativePath" strings
	sortFields: string(),
	sortOrder: SortOrderSchema,
	author: nullable(string()),
	ownerName: nullable(string()),
	ownerEmail: nullable(string()),
	language: string(),
	explicit: string(),
	category: nullable(string()),
	link: nullable(string()),
	copyright: nullable(string()),
	feedType: nullable(FeedTypeSchema),
	filterIn: nullable(string()),
	filterOut: nullable(string()),
	overrides: nullable(string()),
	createdAt: number(),
	updatedAt: number(),
})
export type DirectoryFeed = InferOutput<typeof DirectoryFeedSchema>

export const CuratedFeedSchema = object({
	id: string(),
	name: string(),
	description: string(),
	subtitle: nullable(string()),
	sortFields: string(),
	sortOrder: SortOrderSchema,
	author: nullable(string()),
	ownerName: nullable(string()),
	ownerEmail: nullable(string()),
	language: string(),
	explicit: string(),
	category: nullable(string()),
	link: nullable(string()),
	copyright: nullable(string()),
	feedType: nullable(FeedTypeSchema),
	overrides: nullable(string()),
	createdAt: number(),
	updatedAt: number(),
})
export type CuratedFeed = InferOutput<typeof CuratedFeedSchema>

export const FeedItemSchema = object({
	id: string(),
	feedId: string(),
	mediaRoot: string(),
	relativePath: string(),
	position: nullable(number()),
	addedAt: number(),
})
export type FeedItem = InferOutput<typeof FeedItemSchema>

export const AnalyticsEventTypeSchema = enum_([
	'rss_fetch',
	'media_request',
] as const)
export type AnalyticsEventType = InferOutput<typeof AnalyticsEventTypeSchema>

export const AnalyticsFeedTypeSchema = enum_(['directory', 'curated'] as const)
export type AnalyticsFeedType = InferOutput<typeof AnalyticsFeedTypeSchema>

/**
 * Token for accessing a directory feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export const DirectoryFeedTokenSchema = object({
	token: string(),
	feedId: string(),
	label: string(),
	createdAt: number(),
	lastUsedAt: nullable(number()),
	revokedAt: nullable(number()),
})
export type DirectoryFeedToken = InferOutput<typeof DirectoryFeedTokenSchema>

/**
 * Token for accessing a curated feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export const CuratedFeedTokenSchema = object({
	token: string(),
	feedId: string(),
	label: string(),
	createdAt: number(),
	lastUsedAt: nullable(number()),
	revokedAt: nullable(number()),
})
export type CuratedFeedToken = InferOutput<typeof CuratedFeedTokenSchema>

export const FeedSchema = union([DirectoryFeedSchema, CuratedFeedSchema])
export type Feed = InferOutput<typeof FeedSchema>

export const FeedTokenSchema = union([
	DirectoryFeedTokenSchema,
	CuratedFeedTokenSchema,
])
export type FeedToken = InferOutput<typeof FeedTokenSchema>

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
