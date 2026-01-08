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
import { toolsMetadata } from './metadata.ts'

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
 * Format a date timestamp for human-readable output.
 */
function formatDate(timestamp: number): string {
	const isoString = new Date(timestamp * 1000).toISOString()
	return isoString.split('T')[0] ?? isoString
}

/**
 * Format file size for human-readable output.
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
			toolsMetadata.list_feeds.name,
			toolsMetadata.list_feeds.description,
			{},
			async () => {
				const feeds = getAllFeeds()

				// Format human-readable output
				const lines: string[] = []
				lines.push(`## Feeds (${feeds.length} total)\n`)

				if (feeds.length === 0) {
					lines.push('No feeds created yet.')
					lines.push(
						'\nNext: Use `create_directory_feed` or `create_curated_feed` to create one.',
					)
				} else {
					const directoryFeeds = feeds.filter((f) => f.type === 'directory')
					const curatedFeeds = feeds.filter((f) => f.type === 'curated')

					if (directoryFeeds.length > 0) {
						lines.push(`### Directory Feeds (${directoryFeeds.length})`)
						for (const feed of directoryFeeds) {
							lines.push(
								`- **${feed.name}** (id: \`${feed.id}\`) — Created ${formatDate(feed.createdAt)}`,
							)
							if (feed.description) lines.push(`  ${feed.description}`)
						}
						lines.push('')
					}

					if (curatedFeeds.length > 0) {
						lines.push(`### Curated Feeds (${curatedFeeds.length})`)
						for (const feed of curatedFeeds) {
							lines.push(
								`- **${feed.name}** (id: \`${feed.id}\`) — Created ${formatDate(feed.createdAt)}`,
							)
							if (feed.description) lines.push(`  ${feed.description}`)
						}
						lines.push('')
					}

					lines.push(
						'Next: Use `get_feed` with a feed id for details, or `get_feed_tokens` for RSS URLs.',
					)
				}

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
						feeds: feeds.map((feed) => ({
							id: feed.id,
							name: feed.name,
							description: feed.description,
							type: feed.type,
							createdAt: feed.createdAt,
						})),
						total: feeds.length,
					},
				}
			},
		)

		// Get feed details
		server.tool(
			toolsMetadata.get_feed.name,
			toolsMetadata.get_feed.description,
			{
				id: z.string().describe('The feed ID (from `list_feeds`)'),
			},
			async ({ id }) => {
				const feed = getFeedById(id)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ Feed with ID \`${id}\` not found.\n\nNext: Use \`list_feeds\` to see available feeds.`,
							},
						],
						isError: true,
					}
				}

				// Get feed items (for curated feeds)
				const items =
					feed.type === 'curated' ? getItemsForFeed(id) : ([] as FeedItem[])

				// Format human-readable output
				const lines: string[] = []
				lines.push(`## ${feed.name}`)
				lines.push('')
				lines.push(`- **Type**: ${feed.type}`)
				lines.push(`- **ID**: \`${feed.id}\``)
				lines.push(`- **Created**: ${formatDate(feed.createdAt)}`)
				if (feed.description) {
					lines.push(`- **Description**: ${feed.description}`)
				}

				if (feed.type === 'curated') {
					lines.push('')
					lines.push(`### Items (${items.length})`)
					if (items.length === 0) {
						lines.push('No items yet. Add media files via the admin UI.')
					} else {
						for (const item of items.slice(0, 20)) {
							lines.push(`- ${item.mediaRoot}:${item.relativePath}`)
						}
						if (items.length > 20) {
							lines.push(`- ... and ${items.length - 20} more items`)
						}
					}
				} else {
					lines.push('')
					lines.push(
						'*Directory feed — items are dynamically loaded from the configured folder.*',
					)
				}

				lines.push('')
				lines.push(
					'Next: Use `get_feed_tokens` to get RSS URLs, or `update_feed` to modify.',
				)

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
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
				}
			},
		)

		// List media directories
		server.tool(
			toolsMetadata.list_media_directories.name,
			toolsMetadata.list_media_directories.description,
			{},
			async () => {
				const mediaRoots = getMediaRoots()

				// Format human-readable output
				const lines: string[] = []
				lines.push(`## Media Directories (${mediaRoots.length})\n`)

				if (mediaRoots.length === 0) {
					lines.push('No media directories configured.')
					lines.push(
						'\nAsk the server administrator to configure MEDIA_PATHS environment variable.',
					)
				} else {
					for (const mr of mediaRoots) {
						lines.push(`- **${mr.name}**: \`${mr.path}\``)
					}
					lines.push('')
					lines.push(
						'Next: Use `browse_media` with a media root name to explore contents.',
					)
				}

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
						directories: mediaRoots.map((mr) => ({
							name: mr.name,
							path: mr.path,
						})),
						total: mediaRoots.length,
					},
				}
			},
		)

		// Browse media directory
		server.tool(
			toolsMetadata.browse_media.name,
			toolsMetadata.browse_media.description,
			{
				mediaRoot: z
					.string()
					.describe('Name of the media root (from `list_media_directories`)'),
				subPath: z
					.string()
					.optional()
					.describe('Subdirectory path to browse (default: root)'),
			},
			async ({ mediaRoot, subPath }) => {
				const mediaRoots = getMediaRoots()
				const mr = mediaRoots.find((m) => m.name === mediaRoot)

				if (!mr) {
					const available = mediaRoots.map((m) => m.name).join(', ')
					return {
						content: [
							{
								type: 'text',
								text: `❌ Media root "${mediaRoot}" not found.\n\nAvailable roots: ${available || 'none'}\n\nNext: Use \`list_media_directories\` to see available roots.`,
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
								text: '❌ Invalid path: directory traversal is not allowed.\n\nUse relative paths within the media root only.',
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
								continue
							}
						}

						entries.push({
							name: entry.name,
							type: isDir ? 'directory' : 'file',
							size,
						})
					}

					// Sort: directories first, then files alphabetically
					entries.sort((a, b) => {
						if (a.type !== b.type) {
							return a.type === 'directory' ? -1 : 1
						}
						return a.name.localeCompare(b.name)
					})

					// Format human-readable output
					const displayPath = subPath || '/'
					const lines: string[] = []
					lines.push(`## ${mediaRoot}:${displayPath}\n`)

					const dirs = entries.filter((e) => e.type === 'directory')
					const files = entries.filter((e) => e.type === 'file')

					if (entries.length === 0) {
						lines.push('*Empty directory*')
					} else {
						if (dirs.length > 0) {
							lines.push(`### 📁 Folders (${dirs.length})`)
							for (const dir of dirs) {
								lines.push(`- ${dir.name}/`)
							}
							lines.push('')
						}

						if (files.length > 0) {
							lines.push(`### 📄 Files (${files.length})`)
							for (const file of files) {
								const sizeStr = file.size ? ` (${formatSize(file.size)})` : ''
								lines.push(`- ${file.name}${sizeStr}`)
							}
						}
					}

					lines.push('')
					lines.push(
						'Next: Browse subfolders with `subPath`, or use `create_directory_feed` to create a feed.',
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							path: subPath || '/',
							mediaRoot: mr.name,
							entries,
							counts: {
								directories: dirs.length,
								files: files.length,
							},
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error browsing directory: ${message}\n\nMake sure the path exists and is accessible.`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Get feed tokens
		server.tool(
			toolsMetadata.get_feed_tokens.name,
			toolsMetadata.get_feed_tokens.description,
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
								text: `❌ Feed with ID \`${feedId}\` not found.\n\nNext: Use \`list_feeds\` to see available feeds.`,
							},
						],
						isError: true,
					}
				}

				const tokens: FeedToken[] =
					feed.type === 'directory'
						? listActiveDirectoryFeedTokens(feedId)
						: listActiveCuratedFeedTokens(feedId)

				// Format human-readable output
				const lines: string[] = []
				lines.push(`## Tokens for "${feed.name}"`)
				lines.push('')

				if (tokens.length === 0) {
					lines.push('No active tokens.')
					lines.push('')
					lines.push(
						'Next: Use `create_feed_token` to generate an access token.',
					)
				} else {
					lines.push(`### Active Tokens (${tokens.length})`)
					for (const t of tokens) {
						lines.push(`- \`${t.token}\` — Created ${formatDate(t.createdAt)}`)
						lines.push(`  RSS URL: \`/feed/${feedId}?token=${t.token}\``)
					}
					lines.push('')
					lines.push(
						'Add these URLs to any podcast app to subscribe to the feed.',
					)
					lines.push('')
					lines.push(
						'Next: Use `create_feed_token` for more tokens, or `delete_feed_token` to revoke access.',
					)
				}

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
						feedId,
						feedName: feed.name,
						tokens: tokens.map((t: FeedToken) => ({
							token: t.token,
							label: t.label,
							createdAt: t.createdAt,
							rssUrl: `/feed/${feedId}?token=${t.token}`,
						})),
					},
				}
			},
		)
	}

	// Write tools (require mcp:write scope)
	if (hasScope(authInfo, 'mcp:write')) {
		// Create directory feed
		server.tool(
			toolsMetadata.create_directory_feed.name,
			toolsMetadata.create_directory_feed.description,
			{
				name: z.string().describe('Display name for the feed'),
				description: z
					.string()
					.optional()
					.describe('Description shown in podcast apps'),
				mediaRoot: z.string().describe('Name from `list_media_directories`'),
				directoryPath: z
					.string()
					.describe(
						'Path within the media root (e.g., "Brandon Sanderson/Mistborn")',
					),
			},
			async ({ name, description, mediaRoot, directoryPath }) => {
				const mediaRoots = getMediaRoots()
				const mr = mediaRoots.find((m) => m.name === mediaRoot)

				if (!mr) {
					const available = mediaRoots.map((m) => m.name).join(', ')
					return {
						content: [
							{
								type: 'text',
								text: `❌ Media root "${mediaRoot}" not found.\n\nAvailable roots: ${available || 'none'}\n\nNext: Use \`list_media_directories\` to see available roots.`,
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
								text: '❌ Invalid path: directory traversal is not allowed.\n\nUse relative paths within the media root only.',
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

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Feed created successfully!`)
					lines.push('')
					lines.push(`## ${feed.name}`)
					lines.push(`- **ID**: \`${feed.id}\``)
					lines.push(`- **Type**: directory`)
					lines.push(`- **Source**: ${mediaRoot}:${directoryPath}`)
					if (feed.description) {
						lines.push(`- **Description**: ${feed.description}`)
					}
					lines.push('')
					lines.push(`### RSS Feed URL`)
					lines.push(`\`/feed/${feed.id}?token=${token.token}\``)
					lines.push('')
					lines.push(
						'Add this URL to any podcast app to subscribe to the feed.',
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							feed: {
								id: feed.id,
								name: feed.name,
								description: feed.description,
								type: 'directory',
							},
							token: token.token,
							rssUrl: `/feed/${feed.id}?token=${token.token}`,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error creating feed: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Create curated feed
		server.tool(
			toolsMetadata.create_curated_feed.name,
			toolsMetadata.create_curated_feed.description,
			{
				name: z.string().describe('Display name for the feed'),
				description: z
					.string()
					.optional()
					.describe('Description shown in podcast apps'),
			},
			async ({ name, description }) => {
				try {
					const feed = createCuratedFeed({
						name,
						description: description || undefined,
					})

					// Create initial token
					const token = createCuratedFeedToken({ feedId: feed.id })

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Feed created successfully!`)
					lines.push('')
					lines.push(`## ${feed.name}`)
					lines.push(`- **ID**: \`${feed.id}\``)
					lines.push(`- **Type**: curated`)
					if (feed.description) {
						lines.push(`- **Description**: ${feed.description}`)
					}
					lines.push('')
					lines.push(`### RSS Feed URL`)
					lines.push(`\`/feed/${feed.id}?token=${token.token}\``)
					lines.push('')
					lines.push('The feed starts empty. Add media files via the admin UI.')

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							feed: {
								id: feed.id,
								name: feed.name,
								description: feed.description,
								type: 'curated',
							},
							token: token.token,
							rssUrl: `/feed/${feed.id}?token=${token.token}`,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error creating feed: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Update feed
		server.tool(
			toolsMetadata.update_feed.name,
			toolsMetadata.update_feed.description,
			{
				id: z.string().describe('The feed ID'),
				name: z.string().optional().describe('New name (omit to keep current)'),
				description: z
					.string()
					.optional()
					.describe('New description (omit to keep current)'),
			},
			async ({ id, name, description }) => {
				const feed = getFeedById(id)

				if (!feed) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ Feed with ID \`${id}\` not found.\n\nNext: Use \`list_feeds\` to see available feeds.`,
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

					const updatedFeed = getFeedById(id)!

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Feed updated successfully!`)
					lines.push('')
					lines.push(`## ${updatedFeed.name}`)
					lines.push(`- **ID**: \`${updatedFeed.id}\``)
					lines.push(`- **Type**: ${updatedFeed.type}`)
					if (updatedFeed.description) {
						lines.push(`- **Description**: ${updatedFeed.description}`)
					}
					lines.push('')
					lines.push('Next: Use `get_feed` to see full details.')

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							feed: {
								id: updatedFeed.id,
								name: updatedFeed.name,
								description: updatedFeed.description,
								type: updatedFeed.type,
							},
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error updating feed: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Delete feed
		server.tool(
			toolsMetadata.delete_feed.name,
			toolsMetadata.delete_feed.description,
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
								text: `❌ Feed with ID \`${id}\` not found.\n\nNext: Use \`list_feeds\` to see available feeds.`,
							},
						],
						isError: true,
					}
				}

				try {
					const feedName = feed.name
					if (feed.type === 'directory') {
						deleteDirectoryFeed(id)
					} else {
						deleteCuratedFeed(id)
					}

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Feed "${feedName}" deleted successfully.`)
					lines.push('')
					lines.push('All access tokens for this feed have been invalidated.')
					lines.push('')
					lines.push('Next: Use `list_feeds` to see remaining feeds.')

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							deletedFeedId: id,
							deletedFeedName: feedName,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error deleting feed: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Create feed token
		server.tool(
			toolsMetadata.create_feed_token.name,
			toolsMetadata.create_feed_token.description,
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
								text: `❌ Feed with ID \`${feedId}\` not found.\n\nNext: Use \`list_feeds\` to see available feeds.`,
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

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Token created successfully!`)
					lines.push('')
					lines.push(`### RSS Feed URL`)
					lines.push(`\`/feed/${feedId}?token=${token.token}\``)
					lines.push('')
					lines.push(
						'Add this URL to any podcast app to subscribe to the feed.',
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							feedId,
							feedName: feed.name,
							token: token.token,
							rssUrl: `/feed/${feedId}?token=${token.token}`,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error creating token: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)

		// Delete feed token
		server.tool(
			toolsMetadata.delete_feed_token.name,
			toolsMetadata.delete_feed_token.description,
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
									text: `❌ Token not found or already deleted.\n\nNext: Use \`get_feed_tokens\` with a feed ID to see active tokens.`,
								},
							],
							isError: true,
						}
					}

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Token deleted successfully.`)
					lines.push('')
					lines.push('Anyone using this token has lost access to the feed.')
					lines.push('')
					lines.push(
						'Next: Use `get_feed_tokens` to verify, or `create_feed_token` to issue a replacement.',
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							deletedToken: token,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error deleting token: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)
	}
}
