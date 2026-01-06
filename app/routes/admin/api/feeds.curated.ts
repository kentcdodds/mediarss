import fs from 'node:fs'
import type { Action } from '@remix-run/fetch-router'
import {
	getMediaRootByName,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed } from '#app/db/curated-feeds.ts'
import { addItemToFeed } from '#app/db/feed-items.ts'
import type { SortOrder } from '#app/db/types.ts'

type CreateCuratedFeedRequest = {
	name: string
	description?: string
	sortFields?: string
	sortOrder?: SortOrder
	items: Array<string> // Array of "mediaRoot:relativePath" strings
}

/**
 * POST /admin/api/feeds/curated
 * Creates a new curated feed with the specified items.
 */
export default {
	middleware: [],
	async action(context) {
		if (context.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		let body: CreateCuratedFeedRequest
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

		if (!Array.isArray(body.items)) {
			return Response.json(
				{ error: 'Items must be an array of mediaRoot:relativePath strings' },
				{ status: 400 },
			)
		}

		// Validate sortOrder if provided
		if (body.sortOrder && !['asc', 'desc'].includes(body.sortOrder)) {
			return Response.json(
				{ error: 'sortOrder must be "asc" or "desc"' },
				{ status: 400 },
			)
		}

		// Validate each file path and parse to mediaRoot + relativePath
		const validatedItems: Array<{ mediaRoot: string; relativePath: string }> =
			[]

		for (const mediaPath of body.items) {
			if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
				return Response.json(
					{
						error:
							'Each item must be a non-empty string in mediaRoot:relativePath format',
					},
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

			// Check if file exists
			if (!fs.existsSync(absolutePath)) {
				return Response.json(
					{ error: `File does not exist: ${mediaPath}` },
					{ status: 400 },
				)
			}

			const stat = fs.statSync(absolutePath)
			if (!stat.isFile()) {
				return Response.json(
					{ error: `Path is not a file: ${mediaPath}` },
					{ status: 400 },
				)
			}

			validatedItems.push({ mediaRoot, relativePath })
		}

		// Create the feed
		const feed = createCuratedFeed({
			name: body.name.trim(),
			description: body.description?.trim(),
			sortFields: body.sortFields ?? 'position',
			sortOrder: body.sortOrder ?? 'asc',
		})

		// Add items to the feed with positions
		for (let i = 0; i < validatedItems.length; i++) {
			const item = validatedItems[i]
			if (item) {
				addItemToFeed(feed.id, item.mediaRoot, item.relativePath, i)
			}
		}

		// Automatically create an access token for the new feed
		createCuratedFeedToken({
			feedId: feed.id,
			label: 'Default',
		})

		return Response.json(feed, { status: 201 })
	},
} satisfies Action<
	typeof routes.adminApiCreateCuratedFeed.method,
	typeof routes.adminApiCreateCuratedFeed.pattern.source
>
