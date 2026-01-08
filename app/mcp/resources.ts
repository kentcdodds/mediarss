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
		server.resource(
			'feeds',
			'media://feeds',
			{
				description: 'All available podcast and media feeds',
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
								feeds.map((feed) => ({
									id: feed.id,
									name: feed.name,
									description: feed.description,
									type: feed.type,
									createdAt: feed.createdAt,
								})),
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Individual feed resource
		server.resource(
			'feed',
			new ResourceTemplate('media://feeds/{id}', {
				list: async () => {
					const feeds = getAllFeeds()
					return {
						resources: feeds.map((feed) => ({
							name: feed.name,
							uri: `media://feeds/${feed.id}`,
							mimeType: 'application/json',
							description: feed.description || `Feed ID: ${feed.id}`,
						})),
					}
				},
			}),
			{
				description: 'A specific media feed with its items',
				mimeType: 'application/json',
			},
			async (uri, { id }) => {
				const feedId = String(id)
				const feed = getFeedById(feedId)

				if (!feed) {
					throw new Error(`Feed with ID ${id} not found`)
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
									id: feed.id,
									name: feed.name,
									description: feed.description,
									type: feed.type,
									createdAt: feed.createdAt,
									items: items.map((item: FeedItem) => ({
										id: item.id,
										mediaRoot: item.mediaRoot,
										relativePath: item.relativePath,
										position: item.position,
										addedAt: item.addedAt,
									})),
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
		server.resource(
			'media-directories',
			'media://directories',
			{
				description: 'Configured media directories',
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
								mediaRoots.map((mr) => ({
									name: mr.name,
									path: mr.path,
								})),
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Server info resource
		server.resource(
			'server-info',
			'media://server',
			{
				description: 'Server information and statistics',
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
									server: 'media-server',
									version: '1.0.0',
									stats: {
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
