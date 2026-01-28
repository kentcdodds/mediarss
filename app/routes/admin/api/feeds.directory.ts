import fs from 'node:fs'
import type { BuildAction } from 'remix/fetch-router'
import {
	getMediaRootByName,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import { createDirectoryFeed } from '#app/db/directory-feeds.ts'
import type { SortOrder } from '#app/db/types.ts'

type CreateDirectoryFeedRequest = {
	name: string
	description?: string
	subtitle?: string | null
	directoryPaths: Array<string> // Array of "mediaRoot:relativePath" strings
	sortFields?: string
	sortOrder?: SortOrder
	author?: string | null
	ownerName?: string | null
	ownerEmail?: string | null
	language?: string
	explicit?: string
	category?: string | null
	link?: string | null
	copyright?: string | null
	feedType?: 'episodic' | 'serial'
}

/**
 * POST /admin/api/feeds/directory
 * Creates a new directory feed.
 */
export default {
	middleware: [],
	async action(context) {
		if (context.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		let body: CreateDirectoryFeedRequest
		try {
			body = await context.request.json()
		} catch {
			return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
		}

		// Validate required fields
		if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
			return Response.json(
				{ error: 'Name is required and must be a non-empty string' },
				{ status: 400 },
			)
		}

		if (
			!Array.isArray(body.directoryPaths) ||
			body.directoryPaths.length === 0
		) {
			return Response.json(
				{ error: 'directoryPaths is required and must be a non-empty array' },
				{ status: 400 },
			)
		}

		// Validate each directory path
		const validatedPaths: Array<string> = []
		for (const mediaPath of body.directoryPaths) {
			if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
				return Response.json(
					{ error: 'Each directoryPath must be a non-empty string' },
					{ status: 400 },
				)
			}

			const { mediaRoot, relativePath } = parseMediaPath(mediaPath)

			// Validate media root exists
			const root = getMediaRootByName(mediaRoot)
			if (!root) {
				return Response.json(
					{ error: `Unknown media root: ${mediaRoot}` },
					{ status: 400 },
				)
			}

			// Convert to absolute path and validate
			const absolutePath = toAbsolutePath(mediaRoot, relativePath)
			if (!absolutePath) {
				return Response.json(
					{ error: `Invalid path: ${mediaPath}` },
					{ status: 400 },
				)
			}

			// Check if directory exists
			if (!fs.existsSync(absolutePath)) {
				return Response.json(
					{ error: `Directory does not exist: ${mediaPath}` },
					{ status: 400 },
				)
			}

			const stat = fs.statSync(absolutePath)
			if (!stat.isDirectory()) {
				return Response.json(
					{ error: `Path is not a directory: ${mediaPath}` },
					{ status: 400 },
				)
			}

			validatedPaths.push(mediaPath)
		}

		// Validate sortOrder if provided
		if (body.sortOrder && !['asc', 'desc'].includes(body.sortOrder)) {
			return Response.json(
				{ error: 'sortOrder must be "asc" or "desc"' },
				{ status: 400 },
			)
		}

		// Validate feedType if provided
		if (body.feedType && !['episodic', 'serial'].includes(body.feedType)) {
			return Response.json(
				{ error: 'feedType must be "episodic" or "serial"' },
				{ status: 400 },
			)
		}

		// Create the feed
		const feed = createDirectoryFeed({
			name: body.name.trim(),
			description: body.description?.trim(),
			subtitle: body.subtitle,
			directoryPaths: validatedPaths,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
			author: body.author,
			ownerName: body.ownerName,
			ownerEmail: body.ownerEmail,
			language: body.language,
			explicit: body.explicit,
			category: body.category,
			link: body.link,
			copyright: body.copyright,
			feedType: body.feedType,
		})

		// Automatically create an access token for the new feed
		createDirectoryFeedToken({
			feedId: feed.id,
			label: 'Default',
		})

		return Response.json(feed, { status: 201 })
	},
} satisfies BuildAction<
	typeof routes.adminApiCreateDirectoryFeed.method,
	typeof routes.adminApiCreateDirectoryFeed.pattern
>
