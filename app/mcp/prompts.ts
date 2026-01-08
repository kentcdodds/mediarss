/**
 * MCP Prompts for the media server.
 * Prompts are pre-defined conversation starters that help users accomplish tasks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMediaRoots } from '#app/config/env.ts'
import * as db from '#app/db/index.ts'
import { type AuthInfo, hasScope } from './auth.ts'

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
			'summarize_library',
			'Get a summary of your media library',
			{},
			async () => {
				const feeds = db.getAllFeeds()
				const mediaRoots = getMediaRoots()

				const totalItems = feeds.reduce(
					(sum, feed) => sum + (feed.itemCount || 0),
					0,
				)

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Please provide a summary of my media library.

Current library stats:
- Total feeds: ${feeds.length}
- Directory feeds: ${feeds.filter((f) => f.type === 'directory').length}
- Curated feeds: ${feeds.filter((f) => f.type === 'curated').length}
- Total items across all feeds: ${totalItems}
- Media roots configured: ${mediaRoots.length}

Feeds:
${feeds.map((f) => `- ${f.title} (${f.type}, ${f.itemCount || 0} items)`).join('\n')}

Media roots:
${mediaRoots.map((mr) => `- ${mr.name}: ${mr.path}`).join('\n')}

Please give me an overview of my library and any suggestions for organization.`,
							},
						},
					],
				}
			},
		)

		// Explore feed prompt
		server.prompt(
			'explore_feed',
			'Explore a specific feed and its contents',
			{
				feedId: z.string().describe('The feed ID to explore'),
			},
			async ({ feedId }) => {
				const id = Number(feedId)
				const feed = db.getFeedById(id)

				if (!feed) {
					return {
						messages: [
							{
								role: 'user',
								content: {
									type: 'text',
									text: `Feed with ID ${feedId} was not found. Please use the list_feeds tool to see available feeds.`,
								},
							},
						],
					}
				}

				const items = db.getFeedItems(id)

				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Please explore this feed and tell me about its contents:

Feed: ${feed.title}
Description: ${feed.description || 'No description'}
Type: ${feed.type}
Created: ${feed.createdAt}

Items (${items.length} total):
${items
	.slice(0, 20)
	.map(
		(item) =>
			`- ${item.title}${item.duration ? ` (${formatDuration(item.duration)})` : ''}`,
	)
	.join('\n')}
${items.length > 20 ? `\n... and ${items.length - 20} more items` : ''}

Please provide:
1. A summary of what this feed contains
2. Any patterns you notice in the content
3. Suggestions for organization or improvements`,
							},
						},
					],
				}
			},
		)
	}

	// Write prompts (require mcp:write scope)
	if (hasScope(authInfo, 'mcp:write')) {
		// Create feed prompt
		server.prompt(
			'create_feed_wizard',
			'Interactive wizard to create a new feed',
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
					promptText = `I want to create a new directory-based feed. 

Available media roots:
${mediaRoots.map((mr) => `- ${mr.name}: ${mr.path}`).join('\n')}

Please help me:
1. Choose an appropriate media root
2. Browse the directory to find content
3. Set up the feed with a good title and description

You can use the browse_media tool to explore directories, then create_directory_feed to create the feed.`
				} else if (type === 'curated') {
					promptText = `I want to create a new curated feed where I can manually select content.

Please help me:
1. Come up with a good title and description for the feed
2. Create the feed using create_curated_feed
3. Explain how I can add content to it later`
				} else {
					promptText = `I want to create a new feed. Please help me decide:

1. Should this be a directory feed (automatically includes all media from a folder)?
2. Or a curated feed (manually select specific content)?

Available media roots:
${mediaRoots.map((mr) => `- ${mr.name}: ${mr.path}`).join('\n')}

Please ask me some questions to understand what I'm trying to create, then help me set it up.`
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
			'organize_media',
			'Help organize media into feeds',
			{
				mediaRoot: z.string().optional().describe('The media root to organize'),
			},
			async ({ mediaRoot }) => {
				const mediaRoots = getMediaRoots()

				if (mediaRoot) {
					const mr = mediaRoots.find((m) => m.name === mediaRoot)
					if (!mr) {
						return {
							messages: [
								{
									role: 'user',
									content: {
										type: 'text',
										text: `Media root "${mediaRoot}" not found. Available roots: ${mediaRoots.map((m) => m.name).join(', ')}`,
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
									text: `Please help me organize the media in "${mediaRoot}" (${mr.path}).

Steps:
1. Use browse_media to explore the directory structure
2. Identify logical groupings (by series, author, genre, etc.)
3. Suggest feeds to create for each grouping
4. Create the feeds with appropriate titles and descriptions

Start by browsing the directory to see what's there.`,
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
								text: `I want to organize my media library into feeds.

Available media roots:
${mediaRoots.map((mr) => `- ${mr.name}: ${mr.path}`).join('\n')}

Please help me:
1. Choose which directory to start with
2. Explore its contents
3. Suggest a good organization structure
4. Create feeds for different content groupings

Which directory should we start with?`,
							},
						},
					],
				}
			},
		)
	}
}

/**
 * Format duration in seconds to a human-readable string.
 */
function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}h ${minutes}m`
	} else if (minutes > 0) {
		return `${minutes}m ${secs}s`
	}
	return `${secs}s`
}
