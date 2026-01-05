import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { createDirectoryFeed } from '#app/db/directory-feeds.ts'
import type { SortOrder } from '#app/db/types.ts'

type CreateDirectoryFeedRequest = {
	name: string
	description?: string
	directoryPath: string
	sortFields?: string
	sortOrder?: SortOrder
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
			!body.directoryPath ||
			typeof body.directoryPath !== 'string' ||
			!body.directoryPath.trim()
		) {
			return Response.json(
				{ error: 'Directory path is required' },
				{ status: 400 },
			)
		}

		// Validate the directory path exists and is within a configured media root
		const resolvedPath = nodePath.resolve(body.directoryPath)
		const mediaRoots = getMediaRoots()

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
				{ error: 'Directory path must be within a configured media root' },
				{ status: 400 },
			)
		}

		// Check if directory exists
		if (!fs.existsSync(resolvedPath)) {
			return Response.json(
				{ error: 'Directory does not exist' },
				{ status: 400 },
			)
		}

		const stat = fs.statSync(resolvedPath)
		if (!stat.isDirectory()) {
			return Response.json(
				{ error: 'Path is not a directory' },
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

		// Create the feed
		const feed = createDirectoryFeed({
			name: body.name.trim(),
			description: body.description?.trim(),
			directoryPath: resolvedPath,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
		})

		return Response.json(feed, { status: 201 })
	},
} satisfies Action<
	typeof routes.adminApiCreateDirectoryFeed.method,
	typeof routes.adminApiCreateDirectoryFeed.pattern.source
>
