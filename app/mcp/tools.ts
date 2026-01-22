/**
 * MCP Tools for the media server.
 * Tools provide callable functions that the AI can invoke.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { matchSorter } from 'match-sorter'
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
	parseDirectoryPaths,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import {
	addItemToFeed,
	getItemsForFeed,
	removeItemFromFeed,
} from '#app/db/feed-items.ts'
import type {
	CuratedFeed,
	CuratedFeedToken,
	DirectoryFeed,
	DirectoryFeedToken,
	FeedItem,
} from '#app/db/types.ts'
import { encodeRelativePath, isFileAllowed } from '#app/helpers/feed-access.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import {
	getFileMetadata,
	type MediaFile,
	scanAllMediaRoots,
} from '#app/helpers/media.ts'
import {
	createMediaKey,
	normalizePath,
	parseMediaPathStrict,
} from '#app/helpers/path-parsing.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { toolsMetadata } from './metadata.ts'
import {
	createMediaWidgetResource,
	getMediaWidgetToolMeta,
	type MediaWidgetData,
} from './widgets.ts'

type Feed = DirectoryFeed | CuratedFeed
type FeedToken = DirectoryFeedToken | CuratedFeedToken

type FeedWithType =
	| (DirectoryFeed & { type: 'directory' })
	| (CuratedFeed & { type: 'curated' })

/**
 * ChatGPT / MCP clients may retry tool calls if the connection drops or a response
 * isn't received in time. Our create feed tools used to be non-idempotent, so
 * a retry could create duplicate feeds with identical settings.
 *
 * We avoid that by treating identical create requests within a short window as
 * duplicates and returning the already-created feed instead.
 */
const MCP_CREATE_DEDUPE_WINDOW_SECONDS = 120

function normalizeOptionalText(text: string | undefined): string {
	return text ?? ''
}

function findRecentMatchingCuratedFeed(params: {
	name: string
	description: string
	subtitle: string | null
	sortFields: string
	sortOrder: 'asc' | 'desc'
	imageUrl: string | null
	author: string | null
	ownerName: string | null
	ownerEmail: string | null
	language: string
	explicit: string
	category: string | null
	link: string | null
	copyright: string | null
	feedType: 'episodic' | 'serial'
	overrides: string | null
	now: number
}): CuratedFeed | undefined {
	const cutoff = params.now - MCP_CREATE_DEDUPE_WINDOW_SECONDS
	// listCuratedFeeds() is already sorted newest-first
	for (const feed of listCuratedFeeds()) {
		if (feed.createdAt < cutoff) break
		// Be fairly strict so we don't "dedupe" unrelated older feeds.
		if (
			feed.name === params.name &&
			feed.description === params.description &&
			feed.subtitle === params.subtitle &&
			feed.sortFields === params.sortFields &&
			feed.sortOrder === params.sortOrder &&
			feed.imageUrl === params.imageUrl &&
			feed.author === params.author &&
			feed.ownerName === params.ownerName &&
			feed.ownerEmail === params.ownerEmail &&
			feed.language === params.language &&
			feed.explicit === params.explicit &&
			feed.category === params.category &&
			feed.link === params.link &&
			feed.copyright === params.copyright &&
			(feed.feedType ?? 'episodic') === params.feedType &&
			feed.overrides === params.overrides
		) {
			return feed
		}
	}
	return undefined
}

function findRecentMatchingDirectoryFeed(params: {
	name: string
	description: string
	subtitle: string | null
	directoryPathsJson: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
	imageUrl: string | null
	author: string | null
	ownerName: string | null
	ownerEmail: string | null
	language: string
	explicit: string
	category: string | null
	link: string | null
	copyright: string | null
	feedType: 'episodic' | 'serial'
	filterIn: string | null
	filterOut: string | null
	overrides: string | null
	now: number
}): DirectoryFeed | undefined {
	const cutoff = params.now - MCP_CREATE_DEDUPE_WINDOW_SECONDS
	// listDirectoryFeeds() is already sorted newest-first
	for (const feed of listDirectoryFeeds()) {
		if (feed.createdAt < cutoff) break
		// Be fairly strict so we don't "dedupe" unrelated older feeds.
		if (
			feed.name === params.name &&
			feed.description === params.description &&
			feed.subtitle === params.subtitle &&
			feed.directoryPaths === params.directoryPathsJson &&
			feed.sortFields === params.sortFields &&
			feed.sortOrder === params.sortOrder &&
			feed.imageUrl === params.imageUrl &&
			feed.author === params.author &&
			feed.ownerName === params.ownerName &&
			feed.ownerEmail === params.ownerEmail &&
			feed.language === params.language &&
			feed.explicit === params.explicit &&
			feed.category === params.category &&
			feed.link === params.link &&
			feed.copyright === params.copyright &&
			(feed.feedType ?? 'episodic') === params.feedType &&
			feed.filterIn === params.filterIn &&
			feed.filterOut === params.filterOut &&
			feed.overrides === params.overrides
		) {
			return feed
		}
	}
	return undefined
}

/**
 * Get all feeds (both directory and curated)
 */
function getAllFeeds(): Array<FeedWithType> {
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
function getFeedById(id: string): FeedWithType | undefined {
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

async function validateDirectoryPathsUpdate(
	directoryPaths: Array<string>,
): Promise<
	{ ok: true; directoryPaths: Array<string> } | { ok: false; error: string }
> {
	const mediaRoots = getMediaRoots()
	const { resolve, sep } = await import('node:path')
	const fs = await import('node:fs/promises')

	const errors: string[] = []
	const normalized: string[] = []

	for (const entry of directoryPaths) {
		const trimmed = entry.trim()
		const colonIndex = trimmed.indexOf(':')
		if (colonIndex <= 0 || colonIndex === trimmed.length - 1) {
			errors.push(
				`Invalid directoryPaths entry "${entry}". Expected "mediaRoot:relativePath".`,
			)
			continue
		}

		const mediaRoot = trimmed.slice(0, colonIndex)
		const relativePath = normalizePath(trimmed.slice(colonIndex + 1).trim())

		const mr = mediaRoots.find((m) => m.name === mediaRoot)
		if (!mr) {
			const available = mediaRoots.map((m) => m.name).join(', ')
			errors.push(
				`Unknown media root "${mediaRoot}" in directoryPaths entry "${entry}". Available: ${available || 'none'}`,
			)
			continue
		}

		// Prevent traversal and symlink escape where possible.
		// - Always validate with resolve() to prevent obvious traversal
		// - Additionally validate with realpath() when the target exists (symlink-safe)
		const basePath = resolve(mr.path)
		const fullPath = resolve(basePath, relativePath)

		if (fullPath !== basePath && !fullPath.startsWith(basePath + sep)) {
			errors.push(
				`Invalid directory path "${entry}" (directory traversal is not allowed).`,
			)
			continue
		}

		// If the media root itself isn't accessible, fail early.
		let realBasePath: string
		try {
			realBasePath = await fs.realpath(basePath)
		} catch {
			errors.push(
				`Media root "${mediaRoot}" is not accessible while validating "${entry}".`,
			)
			continue
		}

		// If the target exists, enforce containment using real paths (symlink-safe).
		// If it doesn't exist, keep the resolve() containment check above.
		try {
			const realFullPath = await fs.realpath(
				resolve(realBasePath, relativePath),
			)
			if (
				realFullPath !== realBasePath &&
				!realFullPath.startsWith(realBasePath + sep)
			) {
				errors.push(
					`Invalid directory path "${entry}" (directory traversal is not allowed).`,
				)
				continue
			}
		} catch {
			// ignore: allow non-existent targets as long as resolve()-containment passed
		}

		normalized.push(`${mediaRoot}:${relativePath}`)
	}

	if (errors.length > 0) {
		return { ok: false, error: errors.map((e) => `- ${e}`).join('\n') }
	}

	return { ok: true, directoryPaths: normalized }
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
							if (feed.subtitle) lines.push(`  _${feed.subtitle}_`)
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
							if (feed.subtitle) lines.push(`  _${feed.subtitle}_`)
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
							subtitle: feed.subtitle,
							imageUrl: feed.imageUrl,
							author: feed.author,
							ownerName: feed.ownerName,
							ownerEmail: feed.ownerEmail,
							language: feed.language,
							explicit: feed.explicit,
							category: feed.category,
							link: feed.link,
							copyright: feed.copyright,
							feedType: feed.feedType,
							sortFields: feed.sortFields,
							sortOrder: feed.sortOrder,
							...(feed.type === 'directory'
								? {
										directoryPaths: parseDirectoryPaths(feed),
										filterIn: feed.filterIn,
										filterOut: feed.filterOut,
									}
								: {}),
							overrides: feed.overrides,
							type: feed.type,
							createdAt: feed.createdAt,
							updatedAt: feed.updatedAt,
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
				if (feed.subtitle) {
					lines.push(`- **Subtitle**: ${feed.subtitle}`)
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
							subtitle: feed.subtitle,
							imageUrl: feed.imageUrl,
							author: feed.author,
							ownerName: feed.ownerName,
							ownerEmail: feed.ownerEmail,
							language: feed.language,
							explicit: feed.explicit,
							category: feed.category,
							link: feed.link,
							copyright: feed.copyright,
							feedType: feed.feedType,
							sortFields: feed.sortFields,
							sortOrder: feed.sortOrder,
							...(feed.type === 'directory'
								? {
										directoryPaths: parseDirectoryPaths(feed),
										filterIn: feed.filterIn,
										filterOut: feed.filterOut,
									}
								: {}),
							overrides: feed.overrides,
							type: feed.type,
							createdAt: feed.createdAt,
							updatedAt: feed.updatedAt,
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

		// Search media files
		server.registerTool(
			toolsMetadata.search_media.name,
			{
				title: toolsMetadata.search_media.title,
				description: toolsMetadata.search_media.description,
				inputSchema: {
					query: z
						.string()
						.describe(
							'Search query for fuzzy string matching against media metadata',
						),
					limit: z
						.number()
						.int()
						.min(1)
						.max(100)
						.optional()
						.describe('Maximum results to return (default: 20, max: 100)'),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
				},
			},
			async ({ query, limit = 20 }) => {
				try {
					// Scan all media roots for files
					const allMedia = await scanAllMediaRoots()

					if (allMedia.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text: '❌ No media files found.\n\nMake sure media directories are configured and contain audio/video files.\n\nNext: Use `list_media_directories` to check configuration.',
								},
							],
							isError: true,
						}
					}

					// Get media roots for path mapping
					const mediaRoots = getMediaRoots()

					// Helper to get relative path and media root from absolute path
					// Sort roots by path length descending so longer (more specific) paths match first
					const { sep: pathSep } = await import('node:path')
					const sortedRoots = [...mediaRoots].sort(
						(a, b) => b.path.length - a.path.length,
					)
					const getMediaPathInfo = (
						absolutePath: string,
					): { mediaRoot: string; relativePath: string } | null => {
						for (const root of sortedRoots) {
							// Check for exact match or path with separator to prevent
							// /media/audio matching /media/audiobooks
							// Use path.sep for cross-platform compatibility (/ on Unix, \ on Windows)
							const rootWithSep =
								root.path.endsWith('/') || root.path.endsWith('\\')
									? root.path
									: `${root.path}${pathSep}`
							if (
								absolutePath === root.path ||
								absolutePath.startsWith(rootWithSep)
							) {
								const relativePath = absolutePath
									.slice(root.path.length)
									.replace(/^[/\\]+/, '') // Remove leading slashes
								return { mediaRoot: root.name, relativePath }
							}
						}
						return null
					}

					// First, filter to only media with valid path info
					// Build a map for quick path info lookup
					const pathInfoMap = new Map<
						string,
						{ mediaRoot: string; relativePath: string }
					>()
					const validMedia = allMedia.filter((media) => {
						const pathInfo = getMediaPathInfo(media.path)
						if (pathInfo) {
							pathInfoMap.set(media.path, pathInfo)
							return true
						}
						return false
					})

					// Use match-sorter for fuzzy search on pre-filtered media
					const searchResults = matchSorter(validMedia, query, {
						keys: [
							// Primary search fields (highest priority)
							{ threshold: matchSorter.rankings.CONTAINS, key: 'title' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'author' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'album' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'series' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'filename' },
							// Secondary search fields
							{
								threshold: matchSorter.rankings.CONTAINS,
								key: (item: MediaFile) => item.narrators?.join(' ') ?? '',
							},
							{
								threshold: matchSorter.rankings.CONTAINS,
								key: (item: MediaFile) => item.genres?.join(' ') ?? '',
							},
							{ threshold: matchSorter.rankings.CONTAINS, key: 'description' },
							// Tertiary fields
							{ threshold: matchSorter.rankings.CONTAINS, key: 'composer' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'publisher' },
							{ threshold: matchSorter.rankings.CONTAINS, key: 'albumArtist' },
						],
					})

					// Calculate totals and apply limit
					const totalMatches = searchResults.length
					const truncated = totalMatches > limit
					const limitedResults = searchResults.slice(0, limit)

					// Build results with path info from the map
					const resultsWithPaths = limitedResults.map((media) => ({
						media,
						// Safe to use ! here since we pre-filtered to only valid paths
						pathInfo: pathInfoMap.get(media.path)!,
					}))

					// Format human-readable output
					const lines: string[] = []
					lines.push(`## Search Results for "${query}"`)
					lines.push('')
					lines.push(
						`Found ${totalMatches} match${totalMatches === 1 ? '' : 'es'}${truncated ? ` (showing first ${limit})` : ''}`,
					)
					lines.push('')

					if (resultsWithPaths.length === 0) {
						lines.push('No matches found.')
						lines.push('')
						lines.push(
							'**Tips for better results:**',
							'- Use exact words from titles, authors, or filenames',
							'- Try partial words (e.g., "mist" for "Mistborn")',
							'- Search by file extension (e.g., ".m4b")',
							'- Combine terms: "sanderson stormlight"',
						)
					} else {
						for (const { media, pathInfo } of resultsWithPaths) {
							lines.push(`### ${media.title}`)
							if (media.author) {
								lines.push(`**Author**: ${media.author}`)
							}
							if (media.album) {
								lines.push(`**Album**: ${media.album}`)
							}
							if (media.series) {
								lines.push(`**Series**: ${media.series}`)
							}
							if (media.narrators && media.narrators.length > 0) {
								lines.push(`**Narrated by**: ${media.narrators.join(', ')}`)
							}
							lines.push(`**Duration**: ${formatDuration(media.duration)}`)
							lines.push(`**Format**: ${media.mimeType}`)
							lines.push(
								`**Path**: \`${pathInfo.mediaRoot}:${pathInfo.relativePath}\``,
							)
							lines.push('')
						}
					}

					if (resultsWithPaths.length > 0) {
						lines.push(
							'Next: Use `add_media_to_feeds` to add items to a feed, or `get_media_widget` to play.',
						)
					}

					// Build structured results from the same filtered data
					const structuredResults = resultsWithPaths.map(
						({ media, pathInfo }) => ({
							mediaRoot: pathInfo.mediaRoot,
							relativePath: pathInfo.relativePath,
							title: media.title,
							author: media.author,
							album: media.album,
							series: media.series,
							seriesPosition: media.seriesPosition,
							narrators: media.narrators,
							genres: media.genres,
							duration: media.duration,
							sizeBytes: media.sizeBytes,
							mimeType: media.mimeType,
							filename: media.filename,
						}),
					)

					return {
						content: [{ type: 'text', text: lines.join('\n') }],
						structuredContent: {
							query,
							results: structuredResults,
							total: totalMatches,
							truncated,
						},
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						content: [
							{
								type: 'text',
								text: `❌ Error searching media: ${message}`,
							},
						],
						isError: true,
					}
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
					subtitle: z
						.string()
						.max(255)
						.optional()
						.describe(
							'Short subtitle/tagline (max ~255 chars). If omitted, podcast apps usually show a truncated description.',
						),
					imageUrl: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('Custom feed artwork URL (or null to clear)'),
					author: z
						.string()
						.nullable()
						.optional()
						.describe('Feed author/creator name (or null to clear)'),
					ownerName: z
						.string()
						.nullable()
						.optional()
						.describe('iTunes owner name (or null to clear)'),
					ownerEmail: z
						.string()
						.email()
						.nullable()
						.optional()
						.describe('iTunes owner email (or null to clear)'),
					language: z
						.string()
						.optional()
						.describe('Language code (default: "en")'),
					explicit: z
						.string()
						.optional()
						.describe('Explicit flag (e.g., "no", "yes", "clean")'),
					category: z
						.string()
						.nullable()
						.optional()
						.describe('Category string (or null to clear)'),
					link: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('Website link for the feed (or null to clear)'),
					copyright: z
						.string()
						.nullable()
						.optional()
						.describe('Copyright notice (or null to clear)'),
					feedType: z
						.enum(['episodic', 'serial'])
						.optional()
						.describe('Feed type (Apple Podcasts): "episodic" or "serial"'),
					sortFields: z
						.string()
						.optional()
						.describe(
							'Item sort fields (default: "filename"). For example: "pubDate,track".',
						),
					sortOrder: z
						.enum(['asc', 'desc'])
						.optional()
						.describe('Sort order (default: "asc")'),
					filterIn: z
						.string()
						.nullable()
						.optional()
						.describe('Include filter (or null to clear)'),
					filterOut: z
						.string()
						.nullable()
						.optional()
						.describe('Exclude filter (or null to clear)'),
					overrides: z
						.string()
						.nullable()
						.optional()
						.describe(
							'JSON string of per-item metadata overrides (advanced) (or null to clear)',
						),
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
			async ({
				name,
				description,
				subtitle,
				imageUrl,
				author,
				ownerName,
				ownerEmail,
				language,
				explicit,
				category,
				link,
				copyright,
				feedType,
				sortFields,
				sortOrder,
				filterIn,
				filterOut,
				overrides,
				mediaRoot,
				directoryPath,
			}) => {
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
					const now = Math.floor(Date.now() / 1000)
					const normalizedDescription = normalizeOptionalText(description)
					const normalizedSubtitle = subtitle ?? null
					const normalizedSortFields = sortFields ?? 'filename'
					const normalizedSortOrder = sortOrder ?? 'asc'
					const normalizedImageUrl = imageUrl ?? null
					const normalizedAuthor = author ?? null
					const normalizedOwnerName = ownerName ?? null
					const normalizedOwnerEmail = ownerEmail ?? null
					const normalizedLanguage = language ?? 'en'
					const normalizedExplicit = explicit ?? 'no'
					const normalizedCategory = category ?? null
					const normalizedLink = link ?? null
					const normalizedCopyright = copyright ?? null
					const normalizedFeedType = feedType ?? 'episodic'
					const normalizedFilterIn = filterIn ?? null
					const normalizedFilterOut = filterOut ?? null
					const normalizedOverrides = overrides ?? null
					const directoryPathsJson = JSON.stringify([
						`${mediaRoot}:${directoryPath}`,
					])

					const existing = findRecentMatchingDirectoryFeed({
						name,
						description: normalizedDescription,
						subtitle: normalizedSubtitle,
						directoryPathsJson,
						sortFields: normalizedSortFields,
						sortOrder: normalizedSortOrder,
						imageUrl: normalizedImageUrl,
						author: normalizedAuthor,
						ownerName: normalizedOwnerName,
						ownerEmail: normalizedOwnerEmail,
						language: normalizedLanguage,
						explicit: normalizedExplicit,
						category: normalizedCategory,
						link: normalizedLink,
						copyright: normalizedCopyright,
						feedType: normalizedFeedType,
						filterIn: normalizedFilterIn,
						filterOut: normalizedFilterOut,
						overrides: normalizedOverrides,
						now,
					})

					const feed = existing
						? existing
						: createDirectoryFeed({
								name,
								description: normalizedDescription || undefined,
								subtitle: normalizedSubtitle,
								directoryPaths: [`${mediaRoot}:${directoryPath}`],
								sortFields: normalizedSortFields,
								sortOrder: normalizedSortOrder,
								imageUrl: normalizedImageUrl,
								author: normalizedAuthor,
								ownerName: normalizedOwnerName,
								ownerEmail: normalizedOwnerEmail,
								language: normalizedLanguage,
								explicit: normalizedExplicit,
								category: normalizedCategory,
								link: normalizedLink,
								copyright: normalizedCopyright,
								feedType: normalizedFeedType,
								filterIn: normalizedFilterIn,
								filterOut: normalizedFilterOut,
								overrides: normalizedOverrides,
							})

					// Prefer re-using an existing active token when deduping.
					const token =
						listActiveDirectoryFeedTokens(feed.id)[0] ??
						createDirectoryFeedToken({ feedId: feed.id })

					// Format human-readable output
					const lines: string[] = []
					lines.push(
						existing
							? `ℹ️ Feed already exists (duplicate create request detected).`
							: `✅ Feed created successfully!`,
					)
					lines.push('')
					lines.push(`## ${feed.name}`)
					lines.push(`- **ID**: \`${feed.id}\``)
					lines.push(`- **Type**: directory`)
					lines.push(`- **Source**: ${mediaRoot}:${directoryPath}`)
					if (feed.description) {
						lines.push(`- **Description**: ${feed.description}`)
					}
					if (feed.subtitle) {
						lines.push(`- **Subtitle**: ${feed.subtitle}`)
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
							created: !existing,
							deduplicated: Boolean(existing),
							feed: {
								id: feed.id,
								name: feed.name,
								description: feed.description,
								subtitle: feed.subtitle,
								imageUrl: feed.imageUrl,
								author: feed.author,
								ownerName: feed.ownerName,
								ownerEmail: feed.ownerEmail,
								language: feed.language,
								explicit: feed.explicit,
								category: feed.category,
								link: feed.link,
								copyright: feed.copyright,
								feedType: feed.feedType,
								sortFields: feed.sortFields,
								sortOrder: feed.sortOrder,
								directoryPaths: parseDirectoryPaths(feed),
								filterIn: feed.filterIn,
								filterOut: feed.filterOut,
								overrides: feed.overrides,
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
					subtitle: z
						.string()
						.max(255)
						.optional()
						.describe(
							'Short subtitle/tagline (max ~255 chars). If omitted, podcast apps usually show a truncated description.',
						),
					imageUrl: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('Custom feed artwork URL (or null to clear)'),
					author: z
						.string()
						.nullable()
						.optional()
						.describe('Feed author/creator name (or null to clear)'),
					ownerName: z
						.string()
						.nullable()
						.optional()
						.describe('iTunes owner name (or null to clear)'),
					ownerEmail: z
						.string()
						.email()
						.nullable()
						.optional()
						.describe('iTunes owner email (or null to clear)'),
					language: z
						.string()
						.optional()
						.describe('Language code (default: "en")'),
					explicit: z
						.string()
						.optional()
						.describe('Explicit flag (e.g., "no", "yes", "clean")'),
					category: z
						.string()
						.nullable()
						.optional()
						.describe('Category string (or null to clear)'),
					link: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('Website link for the feed (or null to clear)'),
					copyright: z
						.string()
						.nullable()
						.optional()
						.describe('Copyright notice (or null to clear)'),
					feedType: z
						.enum(['episodic', 'serial'])
						.optional()
						.describe('Feed type (Apple Podcasts): "episodic" or "serial"'),
					sortFields: z
						.string()
						.optional()
						.describe('Item sort fields (default: "position")'),
					sortOrder: z
						.enum(['asc', 'desc'])
						.optional()
						.describe('Sort order (default: "asc")'),
					overrides: z
						.string()
						.nullable()
						.optional()
						.describe(
							'JSON string of per-item metadata overrides (advanced) (or null to clear)',
						),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
			},
			async ({
				name,
				description,
				subtitle,
				imageUrl,
				author,
				ownerName,
				ownerEmail,
				language,
				explicit,
				category,
				link,
				copyright,
				feedType,
				sortFields,
				sortOrder,
				overrides,
			}) => {
				try {
					const now = Math.floor(Date.now() / 1000)
					const normalizedDescription = normalizeOptionalText(description)
					const normalizedSubtitle = subtitle ?? null
					const normalizedSortFields = sortFields ?? 'position'
					const normalizedSortOrder = sortOrder ?? 'asc'
					const normalizedImageUrl = imageUrl ?? null
					const normalizedAuthor = author ?? null
					const normalizedOwnerName = ownerName ?? null
					const normalizedOwnerEmail = ownerEmail ?? null
					const normalizedLanguage = language ?? 'en'
					const normalizedExplicit = explicit ?? 'no'
					const normalizedCategory = category ?? null
					const normalizedLink = link ?? null
					const normalizedCopyright = copyright ?? null
					const normalizedFeedType = feedType ?? 'episodic'
					const normalizedOverrides = overrides ?? null

					const existing = findRecentMatchingCuratedFeed({
						name,
						description: normalizedDescription,
						subtitle: normalizedSubtitle,
						sortFields: normalizedSortFields,
						sortOrder: normalizedSortOrder,
						imageUrl: normalizedImageUrl,
						author: normalizedAuthor,
						ownerName: normalizedOwnerName,
						ownerEmail: normalizedOwnerEmail,
						language: normalizedLanguage,
						explicit: normalizedExplicit,
						category: normalizedCategory,
						link: normalizedLink,
						copyright: normalizedCopyright,
						feedType: normalizedFeedType,
						overrides: normalizedOverrides,
						now,
					})

					const feed = existing
						? existing
						: createCuratedFeed({
								name,
								description: normalizedDescription || undefined,
								subtitle: normalizedSubtitle,
								sortFields: normalizedSortFields,
								sortOrder: normalizedSortOrder,
								imageUrl: normalizedImageUrl,
								author: normalizedAuthor,
								ownerName: normalizedOwnerName,
								ownerEmail: normalizedOwnerEmail,
								language: normalizedLanguage,
								explicit: normalizedExplicit,
								category: normalizedCategory,
								link: normalizedLink,
								copyright: normalizedCopyright,
								feedType: normalizedFeedType,
								overrides: normalizedOverrides,
							})

					// Prefer re-using an existing active token when deduping.
					const token =
						listActiveCuratedFeedTokens(feed.id)[0] ??
						createCuratedFeedToken({ feedId: feed.id })

					// Format human-readable output
					const lines: string[] = []
					lines.push(
						existing
							? `ℹ️ Feed already exists (duplicate create request detected).`
							: `✅ Feed created successfully!`,
					)
					lines.push('')
					lines.push(`## ${feed.name}`)
					lines.push(`- **ID**: \`${feed.id}\``)
					lines.push(`- **Type**: curated`)
					if (feed.description) {
						lines.push(`- **Description**: ${feed.description}`)
					}
					if (feed.subtitle) {
						lines.push(`- **Subtitle**: ${feed.subtitle}`)
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
							created: !existing,
							deduplicated: Boolean(existing),
							feed: {
								id: feed.id,
								name: feed.name,
								description: feed.description,
								subtitle: feed.subtitle,
								imageUrl: feed.imageUrl,
								author: feed.author,
								ownerName: feed.ownerName,
								ownerEmail: feed.ownerEmail,
								language: feed.language,
								explicit: feed.explicit,
								category: feed.category,
								link: feed.link,
								copyright: feed.copyright,
								feedType: feed.feedType,
								sortFields: feed.sortFields,
								sortOrder: feed.sortOrder,
								overrides: feed.overrides,
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
					subtitle: z
						.string()
						.max(255)
						.nullable()
						.optional()
						.describe('New subtitle/tagline (or null to clear)'),
					imageUrl: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('New feed artwork URL (or null to clear)'),
					author: z
						.string()
						.nullable()
						.optional()
						.describe('New author/creator (or null to clear)'),
					ownerName: z
						.string()
						.nullable()
						.optional()
						.describe('New iTunes owner name (or null to clear)'),
					ownerEmail: z
						.string()
						.email()
						.nullable()
						.optional()
						.describe('New iTunes owner email (or null to clear)'),
					owner: z
						.union([
							z.string(),
							z.object({
								name: z.string().nullable().optional(),
								email: z.string().email().nullable().optional(),
							}),
							z.null(),
						])
						.optional()
						.describe(
							'Owner info (optional). Use a string for ownerName, { name, email }, or null to clear both.',
						),
					language: z
						.string()
						.optional()
						.describe('New language code (omit to keep current)'),
					explicit: z
						.string()
						.optional()
						.describe('New explicit flag (omit to keep current)'),
					category: z
						.string()
						.nullable()
						.optional()
						.describe('New category (or null to clear)'),
					link: z
						.string()
						.url()
						.nullable()
						.optional()
						.describe('New website link (or null to clear)'),
					copyright: z
						.string()
						.nullable()
						.optional()
						.describe('New copyright notice (or null to clear)'),
					feedType: z
						.enum(['episodic', 'serial'])
						.optional()
						.describe('New feed type (Apple Podcasts): "episodic" or "serial"'),
					sortFields: z
						.string()
						.optional()
						.describe('New sort fields (omit to keep current)'),
					sortOrder: z
						.enum(['asc', 'desc'])
						.optional()
						.describe('New sort order (omit to keep current)'),
					overrides: z
						.string()
						.nullable()
						.optional()
						.describe('New overrides JSON string (or null to clear)'),
					// Directory-feed-only fields
					directoryPaths: z
						.array(z.string())
						.optional()
						.describe(
							'Directory feed only: array of "mediaRoot:relativePath" entries',
						),
					filterIn: z
						.string()
						.nullable()
						.optional()
						.describe('Directory feed only: include filter (or null to clear)'),
					filterOut: z
						.string()
						.nullable()
						.optional()
						.describe('Directory feed only: exclude filter (or null to clear)'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
			},
			async ({
				id,
				name,
				description,
				subtitle,
				imageUrl,
				author,
				ownerName,
				ownerEmail,
				owner,
				language,
				explicit,
				category,
				link,
				copyright,
				feedType,
				sortFields,
				sortOrder,
				overrides,
				directoryPaths,
				filterIn,
				filterOut,
			}) => {
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
					const ownerIsNull = owner === null
					const resolvedOwnerName =
						ownerName !== undefined
							? ownerName
							: ownerIsNull
								? null
								: typeof owner === 'string'
									? owner
									: owner?.name
					const resolvedOwnerEmail =
						ownerEmail !== undefined
							? ownerEmail
							: ownerIsNull
								? null
								: typeof owner === 'string'
									? undefined
									: owner?.email

					if (feed.type === 'curated') {
						const hasDirectoryOnlyUpdates =
							directoryPaths !== undefined ||
							filterIn !== undefined ||
							filterOut !== undefined
						if (hasDirectoryOnlyUpdates) {
							return {
								content: [
									{
										type: 'text',
										text: `❌ Cannot update directory-only fields on a curated feed.\n\nCurated feed: \`${id}\`\n\nRemove directoryPaths/filterIn/filterOut from the request and try again.`,
									},
								],
								isError: true,
							}
						}
					}

					if (feed.type === 'directory') {
						if (directoryPaths) {
							const validation =
								await validateDirectoryPathsUpdate(directoryPaths)
							if (!validation.ok) {
								return {
									content: [
										{
											type: 'text',
											text: `❌ Invalid directoryPaths.\n\n${validation.error}`,
										},
									],
									isError: true,
								}
							}
							directoryPaths = validation.directoryPaths
						}

						updateDirectoryFeed(id, {
							name,
							description,
							subtitle,
							directoryPaths,
							sortFields,
							sortOrder,
							imageUrl,
							author,
						ownerName: resolvedOwnerName,
						ownerEmail: resolvedOwnerEmail,
							language,
							explicit,
							category,
							link,
							copyright,
							feedType,
							filterIn,
							filterOut,
							overrides,
						})
					} else {
						updateCuratedFeed(id, {
							name,
							description,
							subtitle,
							sortFields,
							sortOrder,
							imageUrl,
							author,
							ownerName: resolvedOwnerName,
							ownerEmail: resolvedOwnerEmail,
							language,
							explicit,
							category,
							link,
							copyright,
							feedType,
							overrides,
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
					if (updatedFeed.subtitle) {
						lines.push(`- **Subtitle**: ${updatedFeed.subtitle}`)
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
								subtitle: updatedFeed.subtitle,
								imageUrl: updatedFeed.imageUrl,
								author: updatedFeed.author,
								ownerName: updatedFeed.ownerName,
								ownerEmail: updatedFeed.ownerEmail,
								language: updatedFeed.language,
								explicit: updatedFeed.explicit,
								category: updatedFeed.category,
								link: updatedFeed.link,
								copyright: updatedFeed.copyright,
								feedType: updatedFeed.feedType,
								sortFields: updatedFeed.sortFields,
								sortOrder: updatedFeed.sortOrder,
								...(updatedFeed.type === 'directory'
									? {
											directoryPaths: parseDirectoryPaths(updatedFeed),
											filterIn: updatedFeed.filterIn,
											filterOut: updatedFeed.filterOut,
										}
									: {}),
								overrides: updatedFeed.overrides,
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

		// Add media to feeds (supports single or bulk operations)
		server.registerTool(
			toolsMetadata.add_media_to_feeds.name,
			{
				title: toolsMetadata.add_media_to_feeds.title,
				description: toolsMetadata.add_media_to_feeds.description,
				inputSchema: {
					items: z
						.array(
							z.object({
								mediaRoot: z.string().describe('Name of the media root'),
								relativePath: z
									.string()
									.describe('Path to the media file within the root'),
							}),
						)
						.min(1)
						.describe('Media files to add'),
					feedIds: z
						.array(z.string())
						.min(1)
						.describe('Curated feed IDs to add the items to'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
				},
			},
			async ({ items, feedIds }) => {
				const mediaRoots = getMediaRoots()
				const { resolve, sep, relative } = await import('node:path')
				const fs = await import('node:fs/promises')

				// Validate all feeds first
				const feedErrors: string[] = []
				const validFeeds: Array<{ id: string; name: string }> = []

				for (const feedId of feedIds) {
					const feed = getCuratedFeedById(feedId)
					if (!feed) {
						const dirFeed = getDirectoryFeedById(feedId)
						if (dirFeed) {
							feedErrors.push(
								`Feed \`${feedId}\` is a directory feed (only curated feeds supported)`,
							)
						} else {
							feedErrors.push(`Feed \`${feedId}\` not found`)
						}
					} else {
						validFeeds.push({ id: feed.id, name: feed.name })
					}
				}

				if (validFeeds.length === 0) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ No valid curated feeds found.\n\nErrors:\n${feedErrors.map((e) => `- ${e}`).join('\n')}\n\nNext: Use \`list_feeds\` to see available feeds.`,
							},
						],
						isError: true,
					}
				}

				// Pre-validate all media items and normalize paths
				type ValidatedItem = {
					mediaRoot: string
					relativePath: string
					normalizedPath: string
				}
				type ItemError = {
					mediaRoot: string
					relativePath: string
					error: string
				}

				const validatedItems: ValidatedItem[] = []
				const itemErrors: ItemError[] = []

				for (const item of items) {
					const mr = mediaRoots.find((m) => m.name === item.mediaRoot)
					if (!mr) {
						itemErrors.push({
							...item,
							error: `Media root "${item.mediaRoot}" not found`,
						})
						continue
					}

					const basePath = resolve(mr.path)
					const fullPath = resolve(basePath, item.relativePath)

					// Resolve real paths to prevent symlink escape
					let realBasePath: string
					let realFullPath: string
					try {
						realBasePath = await fs.realpath(basePath)
					} catch {
						itemErrors.push({
							...item,
							error: `Media root "${item.mediaRoot}" is not accessible`,
						})
						continue
					}

					try {
						realFullPath = await fs.realpath(fullPath)
					} catch {
						itemErrors.push({
							...item,
							error: 'File does not exist',
						})
						continue
					}

					// Check containment
					if (
						realFullPath !== realBasePath &&
						!realFullPath.startsWith(realBasePath + sep)
					) {
						itemErrors.push({
							...item,
							error: 'Invalid path: directory traversal not allowed',
						})
						continue
					}

					// Check if file (not directory)
					try {
						const stat = await fs.stat(realFullPath)
						if (!stat.isFile()) {
							itemErrors.push({
								...item,
								error: 'Path is a directory, not a file',
							})
							continue
						}
					} catch {
						itemErrors.push({
							...item,
							error: 'File is not accessible',
						})
						continue
					}

					// Normalize path using centralized utility
					const normalizedPath = normalizePath(
						relative(realBasePath, realFullPath),
					)
					validatedItems.push({
						mediaRoot: item.mediaRoot,
						relativePath: item.relativePath,
						normalizedPath,
					})
				}

				if (validatedItems.length === 0) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ No valid media items found.\n\nErrors:\n${itemErrors.map((e) => `- ${e.mediaRoot}:${e.relativePath}: ${e.error}`).join('\n')}\n\nNext: Use \`browse_media\` or \`search_media\` to find valid media files.`,
							},
						],
						isError: true,
					}
				}

				// Process each feed
				type FeedResult = {
					feedId: string
					feedName: string
					added: Array<{ mediaRoot: string; relativePath: string }>
					skipped: Array<{
						mediaRoot: string
						relativePath: string
						reason: string
					}>
					errors: Array<{
						mediaRoot: string
						relativePath: string
						error: string
					}>
				}

				const results: FeedResult[] = []
				let totalAdded = 0
				let totalSkipped = 0
				let totalErrors = itemErrors.length * validFeeds.length

				for (const feed of validFeeds) {
					const feedResult: FeedResult = {
						feedId: feed.id,
						feedName: feed.name,
						added: [],
						skipped: [],
						errors: [],
					}

					// Get existing items to check for duplicates (normalize for consistent comparison)
					const existingItems = getItemsForFeed(feed.id)
					const existingSet = new Set(
						existingItems.map((i) =>
							createMediaKey(i.mediaRoot, i.relativePath),
						),
					)

					for (const item of validatedItems) {
						const itemKey = createMediaKey(item.mediaRoot, item.normalizedPath)

						if (existingSet.has(itemKey)) {
							feedResult.skipped.push({
								mediaRoot: item.mediaRoot,
								relativePath: item.normalizedPath,
								reason: 'Already in feed',
							})
							totalSkipped++
							continue
						}

						try {
							addItemToFeed(feed.id, item.mediaRoot, item.normalizedPath)
							feedResult.added.push({
								mediaRoot: item.mediaRoot,
								relativePath: item.normalizedPath,
							})
							totalAdded++
							// Add to set to prevent duplicates within same batch
							existingSet.add(itemKey)
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error)
							feedResult.errors.push({
								mediaRoot: item.mediaRoot,
								relativePath: item.normalizedPath,
								error: message,
							})
							totalErrors++
						}
					}

					// Add item validation errors to each feed result
					for (const err of itemErrors) {
						feedResult.errors.push(err)
					}

					results.push(feedResult)
				}

				// Format human-readable output
				const lines: string[] = []
				const noErrors = totalErrors === 0 && feedErrors.length === 0
				const didChange = totalAdded > 0
				const isNoOp = !didChange && totalSkipped > 0 && noErrors

				if (noErrors && didChange) {
					lines.push(`✅ Add completed successfully!`)
				} else if (isNoOp) {
					lines.push(
						`✅ Add completed (no changes needed - items already in feeds).`,
					)
				} else if (didChange) {
					lines.push(`⚠️ Add completed with some issues.`)
				} else {
					lines.push(`❌ Add failed.`)
				}

				lines.push('')
				lines.push(`## Summary`)
				lines.push(`- **Feeds processed**: ${validFeeds.length}`)
				lines.push(`- **Items per feed**: ${items.length}`)
				lines.push(`- **Total added**: ${totalAdded}`)
				if (totalSkipped > 0) {
					lines.push(`- **Skipped (duplicates)**: ${totalSkipped}`)
				}
				if (totalErrors > 0) {
					lines.push(`- **Errors**: ${totalErrors}`)
				}

				if (feedErrors.length > 0) {
					lines.push('')
					lines.push(`### Feed Errors`)
					for (const err of feedErrors) {
						lines.push(`- ${err}`)
					}
				}

				lines.push('')
				lines.push(`### Results by Feed`)
				for (const result of results) {
					lines.push(
						`- **${result.feedName}**: ${result.added.length} added, ${result.skipped.length} skipped, ${result.errors.length} errors`,
					)
				}

				lines.push('')
				lines.push('Next: Use `get_feed` to verify the feeds were updated.')

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
						success: noErrors || isNoOp,
						feedErrors,
						itemErrors,
						results,
						summary: {
							totalFeeds: validFeeds.length,
							totalItems: items.length,
							totalAdded,
							totalSkipped,
							totalErrors,
						},
					},
				}
			},
		)

		// Remove media from feeds (supports single or bulk operations)
		server.registerTool(
			toolsMetadata.remove_media_from_feeds.name,
			{
				title: toolsMetadata.remove_media_from_feeds.title,
				description: toolsMetadata.remove_media_from_feeds.description,
				inputSchema: {
					items: z
						.array(
							z.object({
								mediaRoot: z.string().describe('Name of the media root'),
								relativePath: z
									.string()
									.describe('Path to the media file within the root'),
							}),
						)
						.min(1)
						.describe('Media files to remove'),
					feedIds: z
						.array(z.string())
						.min(1)
						.describe('Curated feed IDs to remove the items from'),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
				},
			},
			async ({ items, feedIds }) => {
				// Validate all feeds first
				const feedErrors: string[] = []
				const validFeeds: Array<{ id: string; name: string }> = []

				for (const feedId of feedIds) {
					const feed = getCuratedFeedById(feedId)
					if (!feed) {
						const dirFeed = getDirectoryFeedById(feedId)
						if (dirFeed) {
							feedErrors.push(
								`Feed \`${feedId}\` is a directory feed (only curated feeds supported)`,
							)
						} else {
							feedErrors.push(`Feed \`${feedId}\` not found`)
						}
					} else {
						validFeeds.push({ id: feed.id, name: feed.name })
					}
				}

				if (validFeeds.length === 0) {
					return {
						content: [
							{
								type: 'text',
								text: `❌ No valid curated feeds found.\n\nErrors:\n${feedErrors.map((e) => `- ${e}`).join('\n')}\n\nNext: Use \`list_feeds\` to see available feeds.`,
							},
						],
						isError: true,
					}
				}

				// Process each feed
				type FeedResult = {
					feedId: string
					feedName: string
					removed: Array<{ mediaRoot: string; relativePath: string }>
					notFound: Array<{ mediaRoot: string; relativePath: string }>
				}

				const results: FeedResult[] = []
				let totalRemoved = 0
				let totalNotFound = 0

				for (const feed of validFeeds) {
					const feedResult: FeedResult = {
						feedId: feed.id,
						feedName: feed.name,
						removed: [],
						notFound: [],
					}

					for (const item of items) {
						// Normalize path for consistent matching with stored paths
						const normalizedPath = normalizePath(item.relativePath)
						const removed = removeItemFromFeed(
							feed.id,
							item.mediaRoot,
							normalizedPath,
						)

						if (removed) {
							feedResult.removed.push({
								mediaRoot: item.mediaRoot,
								relativePath: normalizedPath,
							})
							totalRemoved++
						} else {
							feedResult.notFound.push({
								mediaRoot: item.mediaRoot,
								relativePath: normalizedPath,
							})
							totalNotFound++
						}
					}

					results.push(feedResult)
				}

				// Format human-readable output
				const lines: string[] = []

				if (totalRemoved > 0 && totalNotFound === 0) {
					lines.push(`✅ Bulk remove completed successfully!`)
				} else if (totalRemoved > 0) {
					lines.push(`⚠️ Bulk remove completed. Some items were not found.`)
				} else {
					lines.push(
						`❌ No items were removed. None of the items were found in the specified feeds.`,
					)
				}

				lines.push('')
				lines.push(`## Summary`)
				lines.push(`- **Feeds processed**: ${validFeeds.length}`)
				lines.push(`- **Items per feed**: ${items.length}`)
				lines.push(`- **Total removed**: ${totalRemoved}`)
				if (totalNotFound > 0) {
					lines.push(`- **Not found**: ${totalNotFound}`)
				}

				if (feedErrors.length > 0) {
					lines.push('')
					lines.push(`### Feed Errors`)
					for (const err of feedErrors) {
						lines.push(`- ${err}`)
					}
				}

				lines.push('')
				lines.push(`### Results by Feed`)
				for (const result of results) {
					lines.push(
						`- **${result.feedName}**: ${result.removed.length} removed, ${result.notFound.length} not found`,
					)
				}

				lines.push('')
				lines.push('Next: Use `get_feed` to verify the feeds were updated.')

				return {
					content: [{ type: 'text', text: lines.join('\n') }],
					structuredContent: {
						success:
							totalRemoved > 0 ||
							(totalNotFound === 0 && feedErrors.length === 0),
						feedErrors,
						results,
						summary: {
							totalFeeds: validFeeds.length,
							totalItems: items.length,
							totalRemoved,
							totalNotFound,
						},
					},
				}
			},
		)
	}
}
