import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listActiveCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import {
	deleteCuratedFeed,
	getCuratedFeedById,
	updateCuratedFeed,
} from '#app/db/curated-feeds.ts'
import { listDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import {
	deleteDirectoryFeed,
	getDirectoryFeedById,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import type { SortOrder } from '#app/db/types.ts'
import {
	getCuratedFeedItems,
	getDirectoryFeedItems,
} from '#app/helpers/feed-items.ts'

/**
 * Simplified media item for the admin UI
 */
type MediaItemResponse = {
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	filename: string
	path: string
}

type UpdateFeedRequest = {
	name?: string
	description?: string
	sortFields?: string
	sortOrder?: SortOrder
	directoryPath?: string // Only for directory feeds
}

/**
 * GET /admin/api/feeds/:id
 * Returns a single feed with its tokens and media items.
 *
 * PUT /admin/api/feeds/:id
 * Updates a feed's properties.
 *
 * DELETE /admin/api/feeds/:id
 * Deletes a feed and all associated tokens/items.
 */
export default {
	middleware: [],
	async action(context) {
		const { id } = context.params

		if (context.method === 'GET') {
			return handleGet(id)
		}

		if (context.method === 'PUT') {
			return handlePut(id, context.request)
		}

		if (context.method === 'DELETE') {
			return handleDelete(id)
		}

		return Response.json({ error: 'Method not allowed' }, { status: 405 })
	},
} satisfies Action<
	typeof routes.adminApiFeed.method,
	typeof routes.adminApiFeed.pattern.source
>

async function handleGet(id: string) {
	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) {
		const tokens = listDirectoryFeedTokens(directoryFeed.id)
		const mediaFiles = await getDirectoryFeedItems(directoryFeed)
		const items: Array<MediaItemResponse> = mediaFiles.map((file) => ({
			title: file.title,
			author: file.author,
			duration: file.duration,
			sizeBytes: file.sizeBytes,
			filename: file.filename,
			path: file.path,
		}))

		return Response.json({
			feed: { ...directoryFeed, type: 'directory' as const },
			tokens,
			items,
		})
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		const tokens = listActiveCuratedFeedTokens(curatedFeed.id)
		const mediaFiles = await getCuratedFeedItems(curatedFeed)
		const items: Array<MediaItemResponse> = mediaFiles.map((file) => ({
			title: file.title,
			author: file.author,
			duration: file.duration,
			sizeBytes: file.sizeBytes,
			filename: file.filename,
			path: file.path,
		}))

		return Response.json({
			feed: { ...curatedFeed, type: 'curated' as const },
			tokens,
			items,
		})
	}

	return Response.json({ error: 'Feed not found' }, { status: 404 })
}

async function handlePut(id: string, request: Request) {
	let body: UpdateFeedRequest
	try {
		body = await request.json()
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	// Validate sortOrder if provided
	if (body.sortOrder && !['asc', 'desc'].includes(body.sortOrder)) {
		return Response.json(
			{ error: 'sortOrder must be "asc" or "desc"' },
			{ status: 400 },
		)
	}

	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) {
		// Validate directoryPath if provided
		if (body.directoryPath !== undefined) {
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

			body.directoryPath = resolvedPath
		}

		const updated = updateDirectoryFeed(id, {
			name: body.name,
			description: body.description,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
			directoryPath: body.directoryPath,
		})

		if (!updated) {
			return Response.json({ error: 'Failed to update feed' }, { status: 500 })
		}

		return Response.json({ ...updated, type: 'directory' as const })
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		// Curated feeds don't have directoryPath
		if (body.directoryPath !== undefined) {
			return Response.json(
				{ error: 'Cannot set directoryPath on a curated feed' },
				{ status: 400 },
			)
		}

		const updated = updateCuratedFeed(id, {
			name: body.name,
			description: body.description,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
		})

		if (!updated) {
			return Response.json({ error: 'Failed to update feed' }, { status: 500 })
		}

		return Response.json({ ...updated, type: 'curated' as const })
	}

	return Response.json({ error: 'Feed not found' }, { status: 404 })
}

function handleDelete(id: string) {
	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) {
		const deleted = deleteDirectoryFeed(id)
		if (!deleted) {
			return Response.json({ error: 'Failed to delete feed' }, { status: 500 })
		}
		return new Response(null, { status: 204 })
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		const deleted = deleteCuratedFeed(id)
		if (!deleted) {
			return Response.json({ error: 'Failed to delete feed' }, { status: 500 })
		}
		return new Response(null, { status: 204 })
	}

	return Response.json({ error: 'Feed not found' }, { status: 404 })
}
