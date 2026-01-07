import { z } from 'zod'

export const SortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof SortOrderSchema>

export const FeedTypeSchema = z.enum(['episodic', 'serial'])
export type FeedType = z.infer<typeof FeedTypeSchema>

export const DirectoryFeedSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	subtitle: z.string().nullable(),
	directoryPaths: z.string(), // JSON array of "mediaRoot:relativePath" strings
	sortFields: z.string(),
	sortOrder: SortOrderSchema,
	imageUrl: z.string().nullable(),
	author: z.string().nullable(),
	ownerName: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	language: z.string(),
	explicit: z.string(),
	category: z.string().nullable(),
	link: z.string().nullable(),
	copyright: z.string().nullable(),
	feedType: FeedTypeSchema,
	filterIn: z.string().nullable(),
	filterOut: z.string().nullable(),
	overrides: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
})
export type DirectoryFeed = z.infer<typeof DirectoryFeedSchema>

export const CuratedFeedSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	subtitle: z.string().nullable(),
	sortFields: z.string(),
	sortOrder: SortOrderSchema,
	imageUrl: z.string().nullable(),
	author: z.string().nullable(),
	ownerName: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	language: z.string(),
	explicit: z.string(),
	category: z.string().nullable(),
	link: z.string().nullable(),
	copyright: z.string().nullable(),
	feedType: FeedTypeSchema,
	overrides: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
})
export type CuratedFeed = z.infer<typeof CuratedFeedSchema>

export const FeedItemSchema = z.object({
	id: z.string(),
	feedId: z.string(),
	mediaRoot: z.string(),
	relativePath: z.string(),
	position: z.number().nullable(),
	addedAt: z.number(),
})
export type FeedItem = z.infer<typeof FeedItemSchema>

/**
 * Token for accessing a directory feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export const DirectoryFeedTokenSchema = z.object({
	token: z.string(),
	feedId: z.string(),
	label: z.string(),
	createdAt: z.number(),
	lastUsedAt: z.number().nullable(),
	revokedAt: z.number().nullable(),
})
export type DirectoryFeedToken = z.infer<typeof DirectoryFeedTokenSchema>

/**
 * Token for accessing a curated feed.
 * Tokens are the only public identifier used in feed URLs.
 * Multiple tokens per feed are allowed for per-client access control.
 */
export const CuratedFeedTokenSchema = z.object({
	token: z.string(),
	feedId: z.string(),
	label: z.string(),
	createdAt: z.number(),
	lastUsedAt: z.number().nullable(),
	revokedAt: z.number().nullable(),
})
export type CuratedFeedToken = z.infer<typeof CuratedFeedTokenSchema>

export const FeedSchema = z.union([DirectoryFeedSchema, CuratedFeedSchema])
export type Feed = z.infer<typeof FeedSchema>

export const FeedTokenSchema = z.union([
	DirectoryFeedTokenSchema,
	CuratedFeedTokenSchema,
])
export type FeedToken = z.infer<typeof FeedTokenSchema>

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
