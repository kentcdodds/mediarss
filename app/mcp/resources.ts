/**
 * MCP Resources for the media server.
 * Resources are data sources that can be read by the AI.
 */

import {
	McpServer,
	ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import { getMediaRoots } from '#app/config/env.ts'
import * as db from '#app/db/index.ts'
import { type AuthInfo, hasScope } from './auth.ts'

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
				const feeds = db.getAllFeeds()

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								feeds.map((feed) => ({
									id: feed.id,
									title: feed.title,
									description: feed.description,
									type: feed.type,
									itemCount: feed.itemCount,
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
					const feeds = db.getAllFeeds()
					return {
						resources: feeds.map((feed) => ({
							name: feed.title,
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
				const feedId = Number(id)
				const feed = db.getFeedById(feedId)

				if (!feed) {
					throw new Error(`Feed with ID ${id} not found`)
				}

				const items = db.getFeedItems(feedId)

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'application/json',
							text: JSON.stringify(
								{
									id: feed.id,
									title: feed.title,
									description: feed.description,
									type: feed.type,
									createdAt: feed.createdAt,
									items: items.map((item) => ({
										id: item.id,
										title: item.title,
										mediaPath: item.mediaPath,
										duration: item.duration,
										publishedAt: item.publishedAt,
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
				const feeds = db.getAllFeeds()
				const mediaRoots = getMediaRoots()

				const totalItems = feeds.reduce(
					(sum, feed) => sum + (feed.itemCount || 0),
					0,
				)

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
										totalItems,
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
