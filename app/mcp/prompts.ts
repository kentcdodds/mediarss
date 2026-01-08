/**
 * MCP Prompts for the media server.
 * Prompts are pre-defined conversation starters that help users accomplish tasks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMediaRoots } from '#app/config/env.ts'
import { getCuratedFeedById, listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
	listDirectoryFeeds,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed, FeedItem } from '#app/db/types.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { promptsMetadata } from './metadata.ts'

type Feed = DirectoryFeed | CuratedFeed

/**
 * Format a date timestamp for human-readable output.
 */
function formatDate(timestamp: number): string {
	return new Date(timestamp * 1000).toISOString().split('T')[0]
}

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
 * Initialize MCP prompts based on authorized scopes.
 */
export async function initializePrompts(
	server: McpServer,
	authInfo: AuthInfo,
): Promise<void> {
	// Read prompts (require mcp:read scope)
	if (hasScope(authInfo, 'mcp:read')) {
		// Summarize library prompt
		server.prompt(
			promptsMetadata.summarize_library.name,
			promptsMetadata.summarize_library.description,
			{},
			async () => {
				const feeds = getAllFeeds()
				const mediaRoots = getMediaRoots()
				const directoryFeeds = feeds.filter((f) => f.type === 'directory')
				const curatedFeeds = feeds.filter((f) => f.type === 'curated')

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Please provide a comprehensive summary of my media library.

## Current Library Statistics

| Metric | Count |
|--------|-------|
| Total Feeds | ${feeds.length} |
| Directory Feeds | ${directoryFeeds.length} |
| Curated Feeds | ${curatedFeeds.length} |
| Media Roots | ${mediaRoots.length} |

## Feeds
${
	feeds.length === 0
		? '*No feeds created yet.*'
		: feeds
				.map(
					(f) =>
						`- **${f.name}** (${f.type}) — ID: \`${f.id}\`, Created: ${formatDate(f.createdAt)}${f.description ? `\n  ${f.description}` : ''}`,
				)
				.join('\n')
}

## Media Roots
${
	mediaRoots.length === 0
		? '*No media directories configured.*'
		: mediaRoots.map((mr) => `- **${mr.name}**: \`${mr.path}\``).join('\n')
}

## Your Task

Please provide:
1. **Overview**: Summarize what's in my library
2. **Organization Assessment**: How well organized is my media?
3. **Recommendations**: Suggest improvements or new feeds to create

You can use \`browse_media\` to explore the media directories and \`get_feed\` to inspect specific feeds.`,
							},
						},
					],
				}
			},
		)

		// Explore feed prompt
		server.prompt(
			promptsMetadata.explore_feed.name,
			promptsMetadata.explore_feed.description,
			{
				feedId: z.string().describe('The feed ID to explore'),
			},
			async ({ feedId }) => {
				const feed = getFeedById(feedId)

				if (!feed) {
					const allFeeds = getAllFeeds()
					return {
						messages: [
							{
								role: 'user',
								content: {
									type: 'text',
									text: `Feed with ID \`${feedId}\` was not found.

## Available Feeds
${
	allFeeds.length === 0
		? '*No feeds exist yet.*'
		: allFeeds
				.map((f) => `- **${f.name}** — ID: \`${f.id}\` (${f.type})`)
				.join('\n')
}

Please use one of the available feed IDs above, or use \`list_feeds\` to see all feeds.`,
								},
							},
						],
					}
				}

				const items =
					feed.type === 'curated' ? getItemsForFeed(feedId) : ([] as FeedItem[])

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Please explore this feed and provide detailed analysis:

## Feed Information

| Property | Value |
|----------|-------|
| Name | ${feed.name} |
| Type | ${feed.type} |
| ID | \`${feed.id}\` |
| Created | ${formatDate(feed.createdAt)} |
| Description | ${feed.description || '*No description*'} |

${
	feed.type === 'curated'
		? `## Items (${items.length} total)
${
	items.length === 0
		? '*No items in this feed yet.*'
		: items
				.slice(0, 25)
				.map(
					(item: FeedItem, i) =>
						`${i + 1}. ${item.mediaRoot}:${item.relativePath}`,
				)
				.join('\n')
}
${items.length > 25 ? `\n*... and ${items.length - 25} more items*` : ''}`
		: `## Source
This is a directory feed — items are automatically loaded from the configured folder(s).`
}

## Your Task

Please analyze this feed and provide:
1. **Content Summary**: What type of content does this feed contain?
2. **Patterns**: Any patterns you notice (series, authors, genres, etc.)
3. **Quality Check**: Are there any issues or inconsistencies?
4. **Suggestions**: How could this feed be improved or better organized?

Use \`browse_media\` to explore the source directories if needed.`,
							},
						},
					],
				}
			},
		)
	}

	// Write prompts (require mcp:write scope)
	if (hasScope(authInfo, 'mcp:write')) {
		// Create feed wizard prompt
		server.prompt(
			promptsMetadata.create_feed_wizard.name,
			promptsMetadata.create_feed_wizard.description,
			{
				type: z
					.enum(['directory', 'curated'])
					.optional()
					.describe('Type of feed to create'),
			},
			async ({ type }) => {
				const mediaRoots = getMediaRoots()

				let promptText: string

				if (type === 'directory') {
					promptText = `# Create a Directory Feed

Directory feeds automatically include all media files from a folder. Perfect for:
- Audiobook series (e.g., all Harry Potter books)
- TV show seasons
- Album collections

## Available Media Roots
${
	mediaRoots.length === 0
		? '*No media directories configured. Ask the admin to set up MEDIA_PATHS.*'
		: mediaRoots.map((mr) => `- **${mr.name}**: \`${mr.path}\``).join('\n')
}

## Your Task

Please help me create a directory feed:

1. **Explore**: Use \`browse_media\` to explore the directories and find content
2. **Choose**: Help me select the right folder for the feed
3. **Name**: Suggest a good name and description
4. **Create**: Use \`create_directory_feed\` to create it

Start by asking which media root I'd like to explore, or browse them to see what's available.`
				} else if (type === 'curated') {
					promptText = `# Create a Curated Feed

Curated feeds let you manually select specific media files. Perfect for:
- Custom playlists (favorites, road trip, etc.)
- Mixed content from different sources
- Hand-picked collections

## Your Task

Please help me create a curated feed:

1. **Purpose**: Ask me what this feed is for
2. **Name**: Help me choose a good name and description
3. **Create**: Use \`create_curated_feed\` to create it
4. **Explain**: Tell me how to add items via the admin UI

What would you like to call this feed, and what will it be used for?`
				} else {
					promptText = `# Feed Creation Wizard

I can help you create a new podcast/media feed. First, let's figure out which type is right for you:

## Feed Types

| Type | Best For | How It Works |
|------|----------|--------------|
| **Directory** | Series, albums, shows | Auto-includes all files from a folder |
| **Curated** | Playlists, favorites | Manually select specific files |

## Available Media Roots
${
	mediaRoots.length === 0
		? '*No media directories configured.*'
		: mediaRoots.map((mr) => `- **${mr.name}**: \`${mr.path}\``).join('\n')
}

## Your Task

Help me decide:
1. **Directory Feed**: Do you have a folder with content you want to turn into a feed?
2. **Curated Feed**: Do you want to hand-pick specific files from different locations?

You can use \`browse_media\` to explore what's available and help me decide.

What are you trying to create?`
				}

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: promptText,
							},
						},
					],
				}
			},
		)

		// Organize media prompt
		server.prompt(
			promptsMetadata.organize_media.name,
			promptsMetadata.organize_media.description,
			{
				mediaRoot: z.string().optional().describe('The media root to organize'),
			},
			async ({ mediaRoot }) => {
				const mediaRoots = getMediaRoots()
				const existingFeeds = getAllFeeds()

				if (mediaRoot) {
					const mr = mediaRoots.find((m) => m.name === mediaRoot)
					if (!mr) {
						return {
							messages: [
								{
									role: 'user',
									content: {
										type: 'text',
										text: `Media root "${mediaRoot}" not found.

## Available Roots
${mediaRoots.map((m) => `- **${m.name}**: \`${m.path}\``).join('\n')}

Please choose one of the available media roots.`,
									},
								},
							],
						}
					}

					return {
						messages: [
							{
								role: 'user',
								content: {
									type: 'text',
									text: `# Organize Media: ${mediaRoot}

Help me organize the media in **${mediaRoot}** (\`${mr.path}\`).

## Existing Feeds (${existingFeeds.length})
${
	existingFeeds.length === 0
		? '*No feeds created yet.*'
		: existingFeeds.map((f) => `- **${f.name}** (${f.type})`).join('\n')
}

## Your Task

1. **Explore**: Use \`browse_media\` to explore the directory structure
2. **Identify**: Find logical groupings (by series, author, genre, etc.)
3. **Suggest**: Propose feeds for each grouping
4. **Create**: Help me create feeds with good names and descriptions

Start by browsing the root directory to see what's available.`,
								},
							},
						],
					}
				}

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `# Organize My Media Library

Help me organize my media files into well-structured feeds.

## Available Media Roots
${
	mediaRoots.length === 0
		? '*No media directories configured.*'
		: mediaRoots.map((mr) => `- **${mr.name}**: \`${mr.path}\``).join('\n')
}

## Existing Feeds (${existingFeeds.length})
${
	existingFeeds.length === 0
		? '*No feeds created yet.*'
		: existingFeeds.map((f) => `- **${f.name}** (${f.type})`).join('\n')
}

## Your Task

1. **Choose**: Which media root should we start with?
2. **Explore**: Browse its contents with \`browse_media\`
3. **Analyze**: Identify logical groupings
4. **Create**: Set up feeds for each group

Which directory would you like to organize?`,
							},
						},
					],
				}
			},
		)
	}
}
