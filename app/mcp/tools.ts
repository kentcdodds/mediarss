/**
 * MCP Tools for the media server.
 * Tools provide callable functions that the AI can invoke.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMediaRoots, toAbsolutePath } from '#app/config/env.ts'
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
import { addItemToFeed, getItemsForFeed } from '#app/db/feed-items.ts'
import type {
	CuratedFeed,
	CuratedFeedToken,
	DirectoryFeed,
	DirectoryFeedToken,
	FeedItem,
} from '#app/db/types.ts'
import { encodeRelativePath, isFileAllowed } from '#app/helpers/feed-access.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { toolsMetadata } from './metadata.ts'
import {
	createMediaWidgetResource,
	getMediaWidgetToolMeta,
	getMediaWidgetUri,
	type MediaWidgetData,
} from './widgets.ts'

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
 * Find a token for accessing a specific media file.
 * Searches through all feeds to find one that has access to the file,
 * then returns the first active token for that feed.
 */
function findTokenForMedia(
	rootName: string,
	relativePath: string,
): { token: string; feed: Feed; type: 'directory' | 'curated' } | null {
	// Check directory feeds first
	const directoryFeeds = listDirectoryFeeds()
	for (const feed of directoryFeeds) {
		if (isFileAllowed(feed, 'directory', rootName, relativePath)) {
			const tokens = listActiveDirectoryFeedTokens(feed.id)
			if (tokens.length > 0) {
				return {
					token: tokens[0]!.token,
					feed,
					type: 'directory',
				}
			}
		}
	}

	// Then check curated feeds
	const curatedFeeds = listCuratedFeeds()
	for (const feed of curatedFeeds) {
		if (isFileAllowed(feed, 'curated', rootName, relativePath)) {
			const tokens = listActiveCuratedFeedTokens(feed.id)
			if (tokens.length > 0) {
				return {
					token: tokens[0]!.token,
					feed,
					type: 'curated',
				}
			}
		}
	}

	return null
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
 * Format duration in seconds to human-readable format.
 */
function formatDuration(seconds: number | null): string {
	if (seconds === null || seconds === 0) return 'Unknown'

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}h ${minutes}m ${secs}s`
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`
	}
	return `${secs}s`
}

/**
 * Initialize MCP tools based on authorized scopes.
 *
 * @param server - The MCP server instance
 * @param authInfo - Authentication information for the user
 * @param baseUrl - Base URL of the server (for widget resources)
 */
export async function initializeTools(
	server: McpServer,
	authInfo: AuthInfo,
	baseUrl: string,
): Promise<void> {
	// Read-only tools (require mcp:read scope)
	if (hasScope(authInfo, 'mcp:read')) {
		// List all feeds
		server.registerTool(
			toolsMetadata.list_feeds.name,
			{
				title: toolsMetadata.list_feeds.title,
				description: toolsMetadata.list_feeds.description,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
			},
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
		server.registerTool(
			toolsMetadata.get_feed.name,
			{
				title: toolsMetadata.get_feed.title,
				description: toolsMetadata.get_feed.description,
				inputSchema: {
					id: z.string().describe('The feed ID (from `list_feeds`)'),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.list_media_directories.name,
			{
				title: toolsMetadata.list_media_directories.title,
				description: toolsMetadata.list_media_directories.description,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
			},
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
		server.registerTool(
			toolsMetadata.browse_media.name,
			{
				title: toolsMetadata.browse_media.title,
				description: toolsMetadata.browse_media.description,
				inputSchema: {
					mediaRoot: z
						.string()
						.describe('Name of the media root (from `list_media_directories`)'),
					subPath: z
						.string()
						.optional()
						.describe('Subdirectory path to browse (default: root)'),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.get_feed_tokens.name,
			{
				title: toolsMetadata.get_feed_tokens.title,
				description: toolsMetadata.get_feed_tokens.description,
				inputSchema: {
					feedId: z.string().describe('The feed ID'),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
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

		// Get media widget
		server.registerTool(
			toolsMetadata.get_media_widget.name,
			{
				title: toolsMetadata.get_media_widget.title,
				description: toolsMetadata.get_media_widget.description,
				inputSchema: {
					mediaRoot: z
						.string()
						.describe('Name of the media root (from `list_media_directories`)'),
					relativePath: z
						.string()
						.describe('Path to the media file within the root'),
					token: z
						.string()
						.optional()
						.describe(
							'A feed access token (optional). If not provided, uses the first available token from a feed that has access to this file.',
						),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
				// OpenAI Apps SDK metadata for ChatGPT widget rendering
				_meta: getMediaWidgetToolMeta(baseUrl),
			},
			async ({ mediaRoot, relativePath, token: providedToken }) => {
				// If no token provided, find one automatically
				let token = providedToken
				let feed: Feed | undefined
				let type: 'directory' | 'curated' | undefined

				if (token) {
					// Validate provided token and get feed
					const result = getFeedByToken(token)
					if (!result) {
						return {
							content: [
								{
									type: 'text',
									text: '❌ Invalid or expired token.\n\nNext: Use `get_feed_tokens` to obtain a valid token for your feed, or omit the token to auto-select one.',
								},
							],
							isError: true,
						}
					}
					feed = result.feed
					type = result.type
				} else {
					// Find a feed that has access to this file and get its first token
					const autoResult = findTokenForMedia(mediaRoot, relativePath)
					if (!autoResult) {
						return {
							content: [
								{
									type: 'text',
									text: `❌ No feed token available for this media file.\n\nNo existing feed has access to "${mediaRoot}:${relativePath}", or the feeds have no active tokens.\n\nNext: Create a directory feed that includes this file using \`create_directory_feed\` (this automatically creates a token), or use \`create_curated_feed\` and add the media to it.`,
								},
							],
							isError: true,
						}
					}
					token = autoResult.token
					feed = autoResult.feed
					type = autoResult.type
				}

				// Parse and validate the path
				const parsed = parseMediaPathStrict(`${mediaRoot}/${relativePath}`)
				if (!parsed) {
					return {
						content: [
							{
								type: 'text',
								text: '❌ Invalid path format.\n\nMake sure to provide a valid mediaRoot and relativePath.',
							},
						],
						isError: true,
					}
				}

				// Get absolute path for the file
				const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
				if (!filePath) {
					const mediaRoots = getMediaRoots()
					const available = mediaRoots.map((m) => m.name).join(', ')
					return {
						content: [
							{
								type: 'text',
								text: `❌ Media root "${parsed.rootName}" not found.\n\nAvailable roots: ${available || 'none'}\n\nNext: Use \`list_media_directories\` to see available roots.`,
							},
						],
						isError: true,
					}
				}

				// Validate file is allowed for this feed (path traversal protection)
				if (!isFileAllowed(feed, type, parsed.rootName, parsed.relativePath)) {
					return {
						content: [
							{
								type: 'text',
								text: '❌ File not found or not accessible with this token.\n\nThe file may not exist, or the token may not have access to this media file.',
							},
						],
						isError: true,
					}
				}

				// Get file metadata
				const metadata = await getFileMetadata(filePath)
				if (!metadata) {
					return {
						content: [
							{
								type: 'text',
								text: '❌ Could not read media file metadata.\n\nThe file may be corrupted or in an unsupported format.',
							},
						],
						isError: true,
					}
				}

				// Generate the legacy widget URI (for backwards compatibility)
				const widgetUri = getMediaWidgetUri(
					token,
					parsed.rootName,
					parsed.relativePath,
				)

				// Build token-based URLs for media streaming
				const encodedPath = encodeRelativePath(
					`${parsed.rootName}/${parsed.relativePath}`,
				)

				// Build the widget data
				const mediaData: MediaWidgetData = {
					title: metadata.title,
					author: metadata.author,
					duration: metadata.duration,
					sizeBytes: metadata.sizeBytes,
					mimeType: metadata.mimeType,
					publicationDate: metadata.publicationDate?.toISOString() ?? null,
					description: metadata.description,
					narrators: metadata.narrators,
					genres: metadata.genres,
					// Use token-based public URLs
					artworkUrl: `/art/${token}/${encodedPath}`,
					streamUrl: `/media/${token}/${encodedPath}`,
				}

				// Create the UIResource for MCP-UI compatible clients
				const uiResource = createMediaWidgetResource({
					baseUrl,
					media: mediaData,
					description: `Media player for ${metadata.title}`,
				})

				// Format human-readable output
				const lines: string[] = []
				lines.push(`## ${metadata.title}`)
				lines.push('')
				if (metadata.author) {
					lines.push(`**Author**: ${metadata.author}`)
				}
				if (metadata.narrators && metadata.narrators.length > 0) {
					lines.push(`**Narrated by**: ${metadata.narrators.join(', ')}`)
				}
				lines.push(`**Duration**: ${formatDuration(metadata.duration)}`)
				lines.push(`**Size**: ${formatSize(metadata.sizeBytes)}`)
				lines.push(`**Format**: ${metadata.mimeType}`)
				if (metadata.genres && metadata.genres.length > 0) {
					lines.push(`**Genres**: ${metadata.genres.join(', ')}`)
				}
				if (metadata.description) {
					lines.push('')
					lines.push('### Description')
					lines.push(metadata.description)
				}
				lines.push('')
				lines.push('The media player widget is ready.')

				// Structured content for programmatic access
				const structuredContent = {
					widgetUri,
					metadata: {
						title: metadata.title,
						author: metadata.author,
						duration: metadata.duration,
						sizeBytes: metadata.sizeBytes,
						mimeType: metadata.mimeType,
						publicationDate: metadata.publicationDate?.toISOString() ?? null,
						description: metadata.description,
						narrators: metadata.narrators,
						genres: metadata.genres,
					},
					access: {
						token,
						mediaRoot: parsed.rootName,
						relativePath: parsed.relativePath,
					},
				}

				// Include both text and the UIResource for ChatGPT/MCP-UI clients
				// The UIResource from @mcp-ui/server is designed to be included directly
				// in tool content arrays per the MCP-UI spec
				return {
					content: [
						{ type: 'text', text: lines.join('\n') },
						uiResource,
						// biome-ignore lint/suspicious/noExplicitAny: UIResource type from @mcp-ui/server is compatible at runtime but TypeScript can't verify cross-package type compatibility
					] as any,
					structuredContent,
				}
			},
		)
	}

	// Write tools (require mcp:write scope)
	if (hasScope(authInfo, 'mcp:write')) {
		// Create directory feed
		server.registerTool(
			toolsMetadata.create_directory_feed.name,
			{
				title: toolsMetadata.create_directory_feed.title,
				description: toolsMetadata.create_directory_feed.description,
				inputSchema: {
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
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.create_curated_feed.name,
			{
				title: toolsMetadata.create_curated_feed.title,
				description: toolsMetadata.create_curated_feed.description,
				inputSchema: {
					name: z.string().describe('Display name for the feed'),
					description: z
						.string()
						.optional()
						.describe('Description shown in podcast apps'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.update_feed.name,
			{
				title: toolsMetadata.update_feed.title,
				description: toolsMetadata.update_feed.description,
				inputSchema: {
					id: z.string().describe('The feed ID'),
					name: z
						.string()
						.optional()
						.describe('New name (omit to keep current)'),
					description: z
						.string()
						.optional()
						.describe('New description (omit to keep current)'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.delete_feed.name,
			{
				title: toolsMetadata.delete_feed.title,
				description: toolsMetadata.delete_feed.description,
				inputSchema: {
					id: z.string().describe('The feed ID to delete'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
				},
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
		server.registerTool(
			toolsMetadata.create_feed_token.name,
			{
				title: toolsMetadata.create_feed_token.title,
				description: toolsMetadata.create_feed_token.description,
				inputSchema: {
					feedId: z.string().describe('The feed ID'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
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
		server.registerTool(
			toolsMetadata.delete_feed_token.name,
			{
				title: toolsMetadata.delete_feed_token.title,
				description: toolsMetadata.delete_feed_token.description,
				inputSchema: {
					token: z.string().describe('The token to delete'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
				},
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

		// Add media to curated feed
		server.registerTool(
			toolsMetadata.add_media_to_curated_feed.name,
			{
				title: toolsMetadata.add_media_to_curated_feed.title,
				description: toolsMetadata.add_media_to_curated_feed.description,
				inputSchema: {
					feedId: z.string().describe('The curated feed ID'),
					mediaRoot: z
						.string()
						.describe('Name of the media root (from `list_media_directories`)'),
					relativePath: z
						.string()
						.describe('Path to the media file within the root'),
					position: z
						.number()
						.int()
						.nonnegative()
						.optional()
						.describe('Position in the feed (0-indexed, appended if omitted)'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
			},
			async ({ feedId, mediaRoot, relativePath, position }) => {
				// Check if feed exists and is a curated feed
				const feed = getCuratedFeedById(feedId)
				if (!feed) {
					// Check if it's a directory feed
					const dirFeed = getDirectoryFeedById(feedId)
					if (dirFeed) {
						return {
							content: [
								{
									type: 'text',
									text: `❌ Feed \`${feedId}\` is a directory feed, not a curated feed.\n\nDirectory feeds automatically include files from their configured folder. Use \`create_curated_feed\` if you need to manually manage items.`,
								},
							],
							isError: true,
						}
					}
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

				// Validate media root exists
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

				// Validate path to prevent directory traversal (including symlink escape)
				const { resolve, sep, relative } = await import('node:path')
				const basePath = resolve(mr.path)
				const fullPath = resolve(basePath, relativePath)

				// Use async fs APIs and realpath to resolve symlinks
				const fs = await import('node:fs/promises')

				// Resolve media root path first (separate error for misconfigured root)
				let realBasePath: string
				try {
					realBasePath = await fs.realpath(basePath)
				} catch {
					return {
						content: [
							{
								type: 'text',
								text: `❌ Media root "${mediaRoot}" is not accessible.\n\nThe configured path may not exist or may have been unmounted.`,
							},
						],
						isError: true,
					}
				}

				// Resolve target file path
				let realFullPath: string
				try {
					realFullPath = await fs.realpath(fullPath)
				} catch {
					return {
						content: [
							{
								type: 'text',
								text: `❌ File does not exist: ${mediaRoot}:${relativePath}\n\nNext: Use \`browse_media\` to explore available files.`,
							},
						],
						isError: true,
					}
				}

				// Check containment using real paths to prevent symlink escape
				if (
					realFullPath !== realBasePath &&
					!realFullPath.startsWith(realBasePath + sep)
				) {
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

				// Check if path is a file (not directory)
				let stat: Awaited<ReturnType<typeof fs.stat>>
				try {
					stat = await fs.stat(realFullPath)
				} catch {
					return {
						content: [
							{
								type: 'text',
								text: `❌ File is not accessible: ${mediaRoot}:${relativePath}\n\nThe file may have been deleted or you may not have permission to access it.`,
							},
						],
						isError: true,
					}
				}
				if (!stat.isFile()) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ Path is not a file: ${mediaRoot}:${relativePath}\n\nOnly files can be added to feeds, not directories.`,
							},
						],
						isError: true,
					}
				}

				// Normalize the relative path to prevent duplicates (e.g., foo//bar vs foo/bar)
				const normalizedRelativePath = relative(realBasePath, realFullPath)

				try {
					// Add the item to the feed with normalized path
					const feedItem = addItemToFeed(
						feedId,
						mediaRoot,
						normalizedRelativePath,
						position,
					)

					// Format human-readable output
					const lines: string[] = []
					lines.push(`✅ Media added to feed successfully!`)
					lines.push('')
					lines.push(`## Added Item`)
					lines.push(`- **Path**: ${mediaRoot}:${normalizedRelativePath}`)
					lines.push(
						`- **Position**: ${feedItem.position !== null ? feedItem.position : 'auto'}`,
					)
					lines.push(`- **Added**: ${formatDate(feedItem.addedAt)}`)
					lines.push('')
					lines.push(
						`Next: Use \`get_feed\` to see all items in "${feed.name}".`,
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							success: true,
							feedItem: {
								id: feedItem.id,
								mediaRoot: feedItem.mediaRoot,
								relativePath: feedItem.relativePath,
								position: feedItem.position,
								addedAt: feedItem.addedAt,
							},
							feed: {
								id: feed.id,
								name: feed.name,
							},
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error adding media to feed: ${message}`,
							},
						],
						isError: true,
					}
				}
			},
		)
	}
}
