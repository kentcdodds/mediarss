/**
 * MCP Resources for the media server.
 * Resources are data sources that can be read by the AI.
 */

import {
	McpServer,
	ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import { getMediaRoots } from '#app/config/env.ts'
import { getCuratedFeedById, listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
	listDirectoryFeeds,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed, FeedItem } from '#app/db/types.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { serverMetadata } from './metadata.ts'

type Feed = DirectoryFeed | CuratedFeed

/**
 * Get all feeds (both directory and curated)
 */
function getAllFeeds(): Array<Feed & { type: 'directory' | 'curated' }> {
	const directoryFeeds = listDirectoryFeeds().map((f) => ({
		...f,
		type: 'directory' as const,
	}))
	const curatedFeeds = listCuratedFeeds().map((f) => ({
		...f,
		type: 'curated' as const,
	}))
	return [...directoryFeeds, ...curatedFeeds].sort(
		(a, b) => b.createdAt - a.createdAt,
	)
}

/**
 * Get a feed by ID (checks both directory and curated)
 */
function getFeedById(
	id: string,
): (Feed & { type: 'directory' | 'curated' }) | undefined {
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) return { ...directoryFeed, type: 'directory' }

	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) return { ...curatedFeed, type: 'curated' }

	return undefined
}

/**
 * Initialize MCP resources based on authorized scopes.
 */
export async function initializeResources(
	server: McpServer,
	authInfo: AuthInfo,
): Promise<void> {
	// Read resources (require mcp:read scope)
	if (hasScope(authInfo, 'mcp:read')) {
		// All feeds resource
		server.registerResource(
			'feeds',
			'media://feeds',
			{
				description:
					'List of all podcast and media feeds. Each feed has an id, name, type (directory or curated), and creation date.',
				mimeType: 'application/json',
			},
			async (uri) => {
				const feeds = getAllFeeds()

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								{
									feeds: feeds.map((feed) => ({
										id: feed.id,
										name: feed.name,
										description: feed.description,
										type: feed.type,
										createdAt: feed.createdAt,
									})),
									total: feeds.length,
									directoryCount: feeds.filter((f) => f.type === 'directory')
										.length,
									curatedCount: feeds.filter((f) => f.type === 'curated')
										.length,
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Individual feed resource
		server.registerResource(
			'feed',
			new ResourceTemplate('media://feeds/{id}', {
				list: async () => {
					const feeds = getAllFeeds()
					return {
						resources: feeds.map((feed) => ({
							name: feed.name,
							uri: `media://feeds/${feed.id}`,
							mimeType: 'application/json',
							description:
								feed.description ||
								`${feed.type === 'directory' ? 'Directory' : 'Curated'} feed — ID: ${feed.id}`,
						})),
					}
				},
			}),
			{
				description:
					'A specific media feed with its configuration and items (for curated feeds).',
				mimeType: 'application/json',
			},
			async (uri, { id }) => {
				const feedId = String(id)
				const feed = getFeedById(feedId)

				if (!feed) {
					throw new Error(
						`Feed with ID "${feedId}" not found. Use media://feeds to list all feeds.`,
					)
				}

				const items =
					feed.type === 'curated' ? getItemsForFeed(feedId) : ([] as FeedItem[])

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								{
									feed: {
										id: feed.id,
										name: feed.name,
										description: feed.description,
										type: feed.type,
										createdAt: feed.createdAt,
									},
									items:
										feed.type === 'curated'
											? items.map((item: FeedItem) => ({
													id: item.id,
													mediaRoot: item.mediaRoot,
													relativePath: item.relativePath,
													position: item.position,
													addedAt: item.addedAt,
												}))
											: 'Items are dynamically loaded from directory',
									itemCount: feed.type === 'curated' ? items.length : null,
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Media directories resource
		server.registerResource(
			'media-directories',
			'media://directories',
			{
				description:
					'Configured media directories that can be browsed and used to create feeds. Each has a name and filesystem path.',
				mimeType: 'application/json',
			},
			async (uri) => {
				const mediaRoots = getMediaRoots()

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								{
									directories: mediaRoots.map((mr) => ({
										name: mr.name,
										path: mr.path,
									})),
									total: mediaRoots.length,
									usage:
										'Use the "name" value with browse_media tool to explore contents.',
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Server info resource
		server.registerResource(
			'server-info',
			'media://server',
			{
				description:
					'Server information including version, statistics, and configuration overview.',
				mimeType: 'application/json',
			},
			async (uri) => {
				const feeds = getAllFeeds()
				const mediaRoots = getMediaRoots()

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								{
									server: {
										name: serverMetadata.name,
										version: serverMetadata.version,
										title: serverMetadata.title,
									},
									statistics: {
										totalFeeds: feeds.length,
										directoryFeeds: feeds.filter((f) => f.type === 'directory')
											.length,
										curatedFeeds: feeds.filter((f) => f.type === 'curated')
											.length,
										mediaRoots: mediaRoots.length,
									},
									mediaRoots: mediaRoots.map((mr) => ({
										name: mr.name,
										path: mr.path,
									})),
									capabilities: {
										tools: [
											'list_feeds',
											'get_feed',
											'list_media_directories',
											'browse_media',
											'get_feed_tokens',
											'create_directory_feed',
											'create_curated_feed',
											'update_feed',
											'delete_feed',
											'create_feed_token',
											'delete_feed_token',
										],
										prompts: [
											'summarize_library',
											'explore_feed',
											'create_feed_wizard',
											'organize_media',
										],
										resources: [
											'media://feeds',
											'media://feeds/{id}',
											'media://directories',
											'media://server',
										],
									},
								},
								null,
								2,
							),
						},
					],
				}
			},
		)
	}
}
