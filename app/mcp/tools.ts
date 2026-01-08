/**
 * MCP Tools for the media server.
 * Tools provide callable functions that the AI can invoke.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMediaRoots } from '#app/config/env.ts'
import {
	createCuratedFeedToken,
	deleteCuratedFeedToken,
	listActiveCuratedFeedTokens,
} from '#app/db/curated-feed-tokens.ts'
import {
	createCuratedFeed,
	deleteCuratedFeed,
	getCuratedFeedById,
	listCuratedFeeds,
	updateCuratedFeed,
} from '#app/db/curated-feeds.ts'
import {
	createDirectoryFeedToken,
	deleteDirectoryFeedToken,
	listActiveDirectoryFeedTokens,
} from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
	getDirectoryFeedById,
	listDirectoryFeeds,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type {
	CuratedFeed,
	CuratedFeedToken,
	DirectoryFeed,
	DirectoryFeedToken,
	FeedItem,
} from '#app/db/types.ts'
import { type AuthInfo, hasScope } from './auth.ts'

type Feed = DirectoryFeed | CuratedFeed
type FeedToken = DirectoryFeedToken | CuratedFeedToken

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
				const feeds = getAllFeeds()

				return {
					content: [
						{
							type: 'text',
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
				id: z.string().describe('The feed ID'),
			},
			async ({ id }) => {
				const feed = getFeedById(id)

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

				// Get feed items (for curated feeds)
				const items =
					feed.type === 'curated' ? getItemsForFeed(id) : ([] as FeedItem[])

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									feed: {
										id: feed.id,
										name: feed.name,
										description: feed.description,
										type: feed.type,
										createdAt: feed.createdAt,
									},
									items: items.map((item: FeedItem) => ({
										id: item.id,
										mediaRoot: item.mediaRoot,
										relativePath: item.relativePath,
										position: item.position,
										addedAt: item.addedAt,
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

				// Resolve paths and validate to prevent directory traversal
				const { resolve, sep } = await import('node:path')
				const basePath = resolve(mr.path)
				const fullPath = subPath ? resolve(basePath, subPath) : basePath

				// Ensure the resolved path stays within the media root
				if (fullPath !== basePath && !fullPath.startsWith(basePath + sep)) {
					return {
						content: [
							{
								type: 'text',
								text: 'Invalid path: directory traversal is not allowed',
							},
						],
						isError: true,
					}
				}

				try {
					const entries: Array<{
						name: string
						type: 'file' | 'directory'
						size?: number
					}> = []

					// Use fs.readdir instead of Bun.Glob + Bun.file().exists()
					// because Bun.file().exists() returns false for directories
					const fs = await import('node:fs/promises')
					const dirEntries = await fs.readdir(fullPath, { withFileTypes: true })

					for (const entry of dirEntries) {
						const isDir = entry.isDirectory()
						let size: number | undefined

						if (!isDir) {
							try {
								const stat = await fs.stat(`${fullPath}/${entry.name}`)
								size = stat.size
							} catch {
								// Skip files we can't stat
								continue
							}
						}

						entries.push({
							name: entry.name,
							type: isDir ? 'directory' : 'file',
							size,
						})
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
				feedId: z.string().describe('The feed ID'),
			},
			async ({ feedId }) => {
				const feed = getFeedById(feedId)

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

				const tokens: FeedToken[] =
					feed.type === 'directory'
						? listActiveDirectoryFeedTokens(feedId)
						: listActiveCuratedFeedTokens(feedId)

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									feedId,
									feedName: feed.name,
									tokens: tokens.map((t: FeedToken) => ({
										token: t.token,
										label: t.label,
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
				name: z.string().describe('The feed name'),
				description: z.string().optional().describe('The feed description'),
				mediaRoot: z
					.string()
					.describe('The media root name (from list_media_directories)'),
				directoryPath: z
					.string()
					.describe('The directory path within the media root'),
			},
			async ({ name, description, mediaRoot, directoryPath }) => {
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

				// Validate directoryPath to prevent path traversal
				const { resolve, sep } = await import('node:path')
				const basePath = resolve(mr.path)
				const fullPath = resolve(basePath, directoryPath)

				if (fullPath !== basePath && !fullPath.startsWith(basePath + sep)) {
					return {
						content: [
							{
								type: 'text',
								text: 'Invalid path: directory traversal is not allowed',
							},
						],
						isError: true,
					}
				}

				try {
					const feed = createDirectoryFeed({
						name,
						description: description || undefined,
						directoryPaths: [`${mediaRoot}:${directoryPath}`],
					})

					// Create initial token
					const token = createDirectoryFeedToken({ feedId: feed.id })

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										feed: {
											id: feed.id,
											name: feed.name,
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
				name: z.string().describe('The feed name'),
				description: z.string().optional().describe('The feed description'),
			},
			async ({ name, description }) => {
				try {
					const feed = createCuratedFeed({
						name,
						description: description || undefined,
					})

					// Create initial token
					const token = createCuratedFeedToken({ feedId: feed.id })

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: true,
										feed: {
											id: feed.id,
											name: feed.name,
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
			'Update a feed name or description',
			{
				id: z.string().describe('The feed ID'),
				name: z.string().optional().describe('New name'),
				description: z.string().optional().describe('New description'),
			},
			async ({ id, name, description }) => {
				const feed = getFeedById(id)

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
						updateDirectoryFeed(id, {
							name: name ?? feed.name,
							description:
								description !== undefined ? description : feed.description,
						})
					} else {
						updateCuratedFeed(id, {
							name: name ?? feed.name,
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
				id: z.string().describe('The feed ID to delete'),
			},
			async ({ id }) => {
				const feed = getFeedById(id)

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
						deleteDirectoryFeed(id)
					} else {
						deleteCuratedFeed(id)
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
				feedId: z.string().describe('The feed ID'),
			},
			async ({ feedId }) => {
				const feed = getFeedById(feedId)

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
							? createDirectoryFeedToken({ feedId })
							: createCuratedFeedToken({ feedId })

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
					const dirDeleted = deleteDirectoryFeedToken(token)
					const curDeleted = deleteCuratedFeedToken(token)

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
