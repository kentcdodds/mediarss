import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { createCuratedFeed } from '#app/db/curated-feeds.ts'
import { addItemToFeed } from '#app/db/feed-items.ts'
import type { SortOrder } from '#app/db/types.ts'

type CreateCuratedFeedRequest = {
	name: string
	description?: string
	sortFields?: string
	sortOrder?: SortOrder
	items: Array<string> // Array of absolute file paths
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
				{ error: 'Items must be an array of file paths' },
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

		// Validate each file path
		const mediaRoots = getMediaRoots()
		const validatedPaths: Array<string> = []

		for (const filePath of body.items) {
			if (typeof filePath !== 'string' || !filePath.trim()) {
				return Response.json(
					{ error: 'Each item must be a non-empty string path' },
					{ status: 400 },
				)
			}

			const resolvedPath = nodePath.resolve(filePath)

			// Check if file is within a configured media root
			let isWithinMediaRoot = false
			for (const root of mediaRoots) {
				const rootResolved = nodePath.resolve(root.path)
				if (
					resolvedPath.startsWith(rootResolved + nodePath.sep) ||
					resolvedPath === rootResolved
				) {
					isWithinMediaRoot = true
					break
				}
			}

			if (!isWithinMediaRoot) {
				return Response.json(
					{
						error: `File path must be within a configured media root: ${filePath}`,
					},
					{ status: 400 },
				)
			}

			// Check if file exists
			if (!fs.existsSync(resolvedPath)) {
				return Response.json(
					{ error: `File does not exist: ${filePath}` },
					{ status: 400 },
				)
			}

			const stat = fs.statSync(resolvedPath)
			if (!stat.isFile()) {
				return Response.json(
					{ error: `Path is not a file: ${filePath}` },
					{ status: 400 },
				)
			}

			validatedPaths.push(resolvedPath)
		}

		// Create the feed
		const feed = createCuratedFeed({
			name: body.name.trim(),
			description: body.description?.trim(),
			sortFields: body.sortFields ?? 'position',
			sortOrder: body.sortOrder ?? 'asc',
		})

		// Add items to the feed with positions
		for (let i = 0; i < validatedPaths.length; i++) {
			const path = validatedPaths[i]
			if (path) {
				addItemToFeed(feed.id, path, i)
			}
		}

		return Response.json(feed, { status: 201 })
	},
} satisfies Action<
	typeof routes.adminApiCreateCuratedFeed.method,
	typeof routes.adminApiCreateCuratedFeed.pattern.source
>
