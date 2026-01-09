/**
 * MCP Resources for the media server.
 * Resources are data sources that can be read by the AI.
 */

import { createUIResource } from '@mcp-ui/server'
import {
	McpServer,
	ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import { getMediaRoots, toAbsolutePath } from '#app/config/env.ts'
import { getCuratedFeedById, listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
	listDirectoryFeeds,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed, FeedItem } from '#app/db/types.ts'
import { encodeRelativePath, isFileAllowed } from '#app/helpers/feed-access.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { serverMetadata } from './metadata.ts'
import {
	generateMediaWidgetHtml,
	getMediaWidgetUIUri,
	type MediaWidgetData,
} from './widgets.ts'

type FeedWithType = (DirectoryFeed | CuratedFeed) & {
	type: 'directory' | 'curated'
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
 * Initialize MCP resources based on authorized scopes.
 *
 * @param server - The MCP server instance
 * @param authInfo - Authentication information for the user
 * @param baseUrl - Base URL of the server (for widget resources)
 */
export async function initializeResources(
	server: McpServer,
	authInfo: AuthInfo,
	baseUrl: string,
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
											'get_media_widget',
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
											'media://widget/media/{token}/{rootName}/{relativePath}',
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

		// Media widget resource - returns HTML for MCP-UI compatible clients
		// Uses token-based authentication to ensure only authorized users can access media
		server.registerResource(
			'media-widget',
			new ResourceTemplate(
				'media://widget/media/{token}/{rootName}/{relativePath+}',
				{
					list: undefined, // Don't list widgets - they're accessed via tokens
				},
			),
			{
				description:
					'Interactive media player widget (MCP-UI). Returns an HTML page with embedded media player for playback. Requires a valid feed token. Use get_feed_tokens to obtain tokens for your feeds.',
				mimeType: 'text/html',
			},
			async (uri, params, extra) => {
				// Decode URI components with error handling for malformed sequences
				let token: string, rootName: string, relativePath: string
				try {
					token = decodeURIComponent(String(params.token))
					rootName = decodeURIComponent(String(params.rootName))
					relativePath = decodeURIComponent(String(params.relativePath))
				} catch {
					throw new Error(
						'Invalid URI encoding in path parameters. Ensure the URI is properly encoded.',
					)
				}

				// Validate token and get feed
				const result = getFeedByToken(token)
				if (!result) {
					throw new Error(
						'Invalid or expired token. Use get_feed_tokens to obtain a valid token.',
					)
				}

				const { feed, type } = result

				// Parse and validate the path
				const parsed = parseMediaPathStrict(`${rootName}/${relativePath}`)
				if (!parsed) {
					throw new Error('Invalid path format.')
				}

				// Get absolute path for the file
				const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
				if (!filePath) {
					throw new Error(`Media root "${parsed.rootName}" not found.`)
				}

				// Validate file is allowed for this feed (path traversal protection)
				if (!isFileAllowed(feed, type, parsed.rootName, parsed.relativePath)) {
					throw new Error('File not found or not accessible with this token.')
				}

				// Get file metadata
				const metadata = await getFileMetadata(filePath)
				if (!metadata) {
					throw new Error(`Media file not found or not readable.`)
				}

				// Determine base URL from the request context, falling back to initialization baseUrl
				const resolvedBaseUrl = getBaseUrlFromExtra(extra, baseUrl)

				// Build token-based URLs
				const encodedPath = encodeRelativePath(
					`${parsed.rootName}/${parsed.relativePath}`,
				)

				// Build the widget data with token-based URLs
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
					// Use token-based public URLs, not admin URLs
					artworkUrl: `/art/${token}/${encodedPath}`,
					streamUrl: `/media/${token}/${encodedPath}`,
				}

				// Generate the HTML widget
				const html = generateMediaWidgetHtml({
					baseUrl: resolvedBaseUrl,
					media: mediaData,
				})

				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: 'text/html',
							text: html,
						},
					],
				}
			},
		)

		// Media widget template resource for ChatGPT Apps SDK
		// This is a template resource that ChatGPT uses to render widgets
		const widgetUri = getMediaWidgetUIUri()
		const hostname = new URL(baseUrl).hostname

		// Pre-generate the placeholder HTML for the template
		const placeholderHtml = generateMediaWidgetHtml({
			baseUrl,
			media: {
				title: 'Loading...',
				author: null,
				duration: null,
				sizeBytes: 0,
				mimeType: 'audio/mpeg',
				publicationDate: null,
				description: null,
				narrators: null,
				genres: null,
				artworkUrl: '',
				streamUrl: '',
			},
		})

		// Pre-create the UIResource with Apps SDK adapter enabled
		const templateUiResource = createUIResource({
			uri: widgetUri,
			content: {
				type: 'rawHtml',
				htmlString: placeholderHtml,
			},
			encoding: 'text',
			metadata: {
				'openai/widgetDescription':
					'Interactive media player for audio and video files',
				'openai/widgetCSP': {
					connect_domains: [hostname],
					resource_domains: [hostname],
				},
			},
			adapters: {
				appsSdk: {
					enabled: true,
				},
			},
		})

		server.registerResource(
			'media-widget-template',
			widgetUri,
			{
				description:
					'Media player widget template for ChatGPT. Use with the get_media_widget tool to render an interactive media player.',
				mimeType: 'text/html+skybridge',
			},
			async (_uri) => {
				return {
					contents: [templateUiResource.resource],
				}
			},
		)
	}
}

/**
 * Extract base URL from the extra context provided by the transport.
 * Falls back to a reasonable default if not available.
 */
function getBaseUrlFromExtra(extra: unknown, fallback?: string): string {
	// The transport may pass authInfo which contains issuer info
	if (extra && typeof extra === 'object' && 'authInfo' in extra) {
		const authInfo = extra.authInfo as { issuer?: string }
		if (authInfo.issuer) {
			return authInfo.issuer
		}
	}

	// Use fallback if provided, otherwise default to environment variable or localhost
	return fallback ?? Bun.env.PUBLIC_URL ?? 'http://localhost:3000'
}
