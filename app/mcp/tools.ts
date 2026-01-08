/**
 * MCP Tools for the media server.
 * Tools provide callable functions that the AI can invoke.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMediaRoots } from '#app/config/env.ts'
import * as db from '#app/db/index.ts'
import { type AuthInfo, hasScope } from './auth.ts'

/**
 * Initialize MCP tools based on authorized scopes.
 */
export async function initializeTools(
	server: McpServer,
	authInfo: AuthInfo,
): Promise<void> {
	// Read-only tools (require mcp:read scope)
	if (hasScope(authInfo, 'mcp:read')) {
		// List all feeds
		server.tool(
			'list_feeds',
			'List all available podcast and media feeds',
			{},
			async () => {
				const feeds = db.getAllFeeds()

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									feeds: feeds.map((feed) => ({
										id: feed.id,
										title: feed.title,
										description: feed.description,
										type: feed.type,
										itemCount: feed.itemCount,
										createdAt: feed.createdAt,
									})),
									total: feeds.length,
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Get feed details
		server.tool(
			'get_feed',
			'Get details about a specific feed including its items',
			{
				id: z.number().describe('The feed ID'),
			},
			async ({ id }) => {
				const feed = db.getFeedById(id)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `Feed with ID ${id} not found`,
							},
						],
						isError: true,
					}
				}

				// Get feed items
				const items = db.getFeedItems(id)

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									feed: {
										id: feed.id,
										title: feed.title,
										description: feed.description,
										type: feed.type,
										createdAt: feed.createdAt,
									},
									items: items.map((item) => ({
										id: item.id,
										title: item.title,
										mediaPath: item.mediaPath,
										duration: item.duration,
										publishedAt: item.publishedAt,
									})),
									itemCount: items.length,
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// List media directories
		server.tool(
			'list_media_directories',
			'List configured media directories that can be browsed',
			{},
			async () => {
				const mediaRoots = getMediaRoots()

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									directories: mediaRoots.map((mr) => ({
										name: mr.name,
										path: mr.path,
									})),
									total: mediaRoots.length,
								},
								null,
								2,
							),
						},
					],
				}
			},
		)

		// Browse media directory
		server.tool(
			'browse_media',
			'Browse files in a media directory',
			{
				mediaRoot: z
					.string()
					.describe(
						'The name of the media root to browse (from list_media_directories)',
					),
				subPath: z
					.string()
					.optional()
					.describe('Optional subdirectory path to browse'),
			},
			async ({ mediaRoot, subPath }) => {
				const mediaRoots = getMediaRoots()
				const mr = mediaRoots.find((m) => m.name === mediaRoot)

				if (!mr) {
					return {
						content: [
							{
								type: 'text',
								text: `Media root "${mediaRoot}" not found. Use list_media_directories to see available roots.`,
							},
						],
						isError: true,
					}
				}

				const fullPath = subPath
					? `${mr.path}/${subPath}`.replace(/\/+/g, '/')
					: mr.path

				try {
					const entries: Array<{
						name: string
						type: 'file' | 'directory'
						size?: number
					}> = []

					const glob = new Bun.Glob('*')
					for await (const entry of glob.scan({
						cwd: fullPath,
						onlyFiles: false,
					})) {
						const entryPath = `${fullPath}/${entry}`
						const file = Bun.file(entryPath)
						const exists = await file.exists()

						if (exists) {
							const stat = await file.stat()
							entries.push({
								name: entry,
								type: stat?.isDirectory ? 'directory' : 'file',
								size: stat?.isDirectory ? undefined : stat?.size,
							})
						}
					}

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										path: subPath || '/',
										mediaRoot: mr.name,
										entries: entries.sort((a, b) => {
											// Directories first, then files
											if (a.type !== b.type) {
												return a.type === 'directory' ? -1 : 1
											}
											return a.name.localeCompare(b.name)
										}),
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error browsing directory: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Get feed tokens
		server.tool(
			'get_feed_tokens',
			'Get the access tokens for a feed',
			{
				feedId: z.number().describe('The feed ID'),
			},
			async ({ feedId }) => {
				const feed = db.getFeedById(feedId)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `Feed with ID ${feedId} not found`,
							},
						],
						isError: true,
					}
				}

				const tokens =
					feed.type === 'directory'
						? db.getDirectoryFeedTokens(feedId)
						: db.getCuratedFeedTokens(feedId)

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									feedId,
									feedTitle: feed.title,
									tokens: tokens.map((t) => ({
										token: t.token,
										createdAt: t.createdAt,
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

	// Write tools (require mcp:write scope)
	if (hasScope(authInfo, 'mcp:write')) {
		// Create directory feed
		server.tool(
			'create_directory_feed',
			'Create a new feed from a media directory',
			{
				title: z.string().describe('The feed title'),
				description: z.string().optional().describe('The feed description'),
				mediaRoot: z
					.string()
					.describe('The media root name (from list_media_directories)'),
				directoryPath: z
					.string()
					.describe('The directory path within the media root'),
			},
			async ({ title, description, mediaRoot, directoryPath }) => {
				const mediaRoots = getMediaRoots()
				const mr = mediaRoots.find((m) => m.name === mediaRoot)

				if (!mr) {
					return {
						content: [
							{
								type: 'text',
								text: `Media root "${mediaRoot}" not found`,
							},
						],
						isError: true,
					}
				}

				try {
					const feed = db.createDirectoryFeed({
						title,
						description: description || null,
						mediaPath: mediaRoot,
						directoryPath,
					})

					// Create initial token
					const token = db.createDirectoryFeedToken(feed.id)

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										feed: {
											id: feed.id,
											title: feed.title,
											description: feed.description,
										},
										token: token.token,
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error creating feed: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Create curated feed
		server.tool(
			'create_curated_feed',
			'Create a new curated feed (manually managed)',
			{
				title: z.string().describe('The feed title'),
				description: z.string().optional().describe('The feed description'),
			},
			async ({ title, description }) => {
				try {
					const feed = db.createCuratedFeed({
						title,
						description: description || null,
					})

					// Create initial token
					const token = db.createCuratedFeedToken(feed.id)

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										feed: {
											id: feed.id,
											title: feed.title,
											description: feed.description,
										},
										token: token.token,
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error creating feed: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Update feed
		server.tool(
			'update_feed',
			'Update a feed title or description',
			{
				id: z.number().describe('The feed ID'),
				title: z.string().optional().describe('New title'),
				description: z.string().optional().describe('New description'),
			},
			async ({ id, title, description }) => {
				const feed = db.getFeedById(id)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `Feed with ID ${id} not found`,
							},
						],
						isError: true,
					}
				}

				try {
					if (feed.type === 'directory') {
						db.updateDirectoryFeed(id, {
							title: title ?? feed.title,
							description:
								description !== undefined ? description : feed.description,
						})
					} else {
						db.updateCuratedFeed(id, {
							title: title ?? feed.title,
							description:
								description !== undefined ? description : feed.description,
						})
					}

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										message: `Feed ${id} updated successfully`,
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error updating feed: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Delete feed
		server.tool(
			'delete_feed',
			'Delete a feed',
			{
				id: z.number().describe('The feed ID to delete'),
			},
			async ({ id }) => {
				const feed = db.getFeedById(id)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `Feed with ID ${id} not found`,
							},
						],
						isError: true,
					}
				}

				try {
					if (feed.type === 'directory') {
						db.deleteDirectoryFeed(id)
					} else {
						db.deleteCuratedFeed(id)
					}

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										message: `Feed ${id} deleted successfully`,
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error deleting feed: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Create feed token
		server.tool(
			'create_feed_token',
			'Create a new access token for a feed',
			{
				feedId: z.number().describe('The feed ID'),
			},
			async ({ feedId }) => {
				const feed = db.getFeedById(feedId)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `Feed with ID ${feedId} not found`,
							},
						],
						isError: true,
					}
				}

				try {
					const token =
						feed.type === 'directory'
							? db.createDirectoryFeedToken(feedId)
							: db.createCuratedFeedToken(feedId)

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										feedId,
										token: token.token,
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error creating token: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Delete feed token
		server.tool(
			'delete_feed_token',
			'Delete an access token for a feed',
			{
				token: z.string().describe('The token to delete'),
			},
			async ({ token }) => {
				try {
					// Try both token types
					const dirDeleted = db.deleteDirectoryFeedToken(token)
					const curDeleted = db.deleteCuratedFeedToken(token)

					if (!dirDeleted && !curDeleted) {
						return {
							content: [
								{
									type: 'text',
									text: `Token not found`,
								},
							],
							isError: true,
						}
					}

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										message: 'Token deleted successfully',
									},
									null,
									2,
								),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error deleting token: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					}
				}
			},
		)
	}
}
