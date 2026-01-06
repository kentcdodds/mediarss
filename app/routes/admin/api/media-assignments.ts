import type { Action } from '@remix-run/fetch-router'
import { getMediaRootByName, parseMediaPath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import { listDirectoryFeeds } from '#app/db/directory-feeds.ts'
import {
	addItemToFeed,
	getItemsForFeed,
	removeItemFromFeed,
} from '#app/db/feed-items.ts'
import { db } from '#app/db/index.ts'
import { parseRows, sql } from '#app/db/sql.ts'
import { FeedItemSchema } from '#app/db/types.ts'

type FeedAssignment = {
	feedId: string
	feedType: 'curated' | 'directory'
}

type AssignmentsResponse = {
	assignments: Record<string, Array<FeedAssignment>>
	curatedFeeds: Array<{ id: string; name: string; imageUrl: string | null }>
	directoryFeeds: Array<{
		id: string
		name: string
		directoryPaths: Array<string> // Array of "mediaRoot:relativePath" strings
		imageUrl: string | null
	}>
}

type UpdateAssignmentsRequest = {
	mediaPath: string // "mediaRoot:relativePath" format
	feedIds: Array<string>
}

/**
 * GET /admin/api/media/assignments
 * Returns feed assignments for all media files plus available feeds.
 *
 * PUT /admin/api/media/assignments
 * Updates curated feed assignments for a single file.
 */
export default {
	middleware: [],
	async action(context) {
		if (context.method === 'GET') {
			return handleGet()
		}

		if (context.method === 'PUT') {
			return handlePut(context.request)
		}

		return Response.json({ error: 'Method not allowed' }, { status: 405 })
	},
} satisfies Action<
	typeof routes.adminApiMediaAssignments.method,
	typeof routes.adminApiMediaAssignments.pattern.source
>

function handleGet(): Response {
	const curatedFeeds = listCuratedFeeds()
	const directoryFeeds = listDirectoryFeeds()

	// Get all feed items from the database
	const allFeedItems = parseRows(
		FeedItemSchema,
		db.query<Record<string, unknown>, []>(sql`SELECT * FROM feed_items;`).all(),
	)

	// Build assignments map using mediaRoot:relativePath as key
	const assignments: Record<string, Array<FeedAssignment>> = {}

	// Add curated feed assignments from feed_items table
	for (const item of allFeedItems) {
		const mediaPath = item.relativePath
			? `${item.mediaRoot}:${item.relativePath}`
			: item.mediaRoot
		const existing = assignments[mediaPath]
		if (existing) {
			existing.push({
				feedId: item.feedId,
				feedType: 'curated',
			})
		} else {
			assignments[mediaPath] = [
				{
					feedId: item.feedId,
					feedType: 'curated',
				},
			]
		}
	}

	// Note: Directory feed assignments are computed on-the-fly in the client
	// based on file paths, since we don't have all file paths here.
	// The client will match files against directoryFeeds[].directoryPaths

	return Response.json({
		assignments,
		curatedFeeds: curatedFeeds.map((f) => ({
			id: f.id,
			name: f.name,
			imageUrl: f.imageUrl,
		})),
		directoryFeeds: directoryFeeds.map((f) => ({
			id: f.id,
			name: f.name,
			directoryPaths: JSON.parse(f.directoryPaths) as Array<string>,
			imageUrl: f.imageUrl,
		})),
	} satisfies AssignmentsResponse)
}

async function handlePut(request: Request): Promise<Response> {
	let body: UpdateAssignmentsRequest
	try {
		body = await request.json()
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	const { mediaPath, feedIds } = body

	if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
		return Response.json(
			{
				error:
					'mediaPath is required and must be a non-empty string in mediaRoot:relativePath format',
			},
			{ status: 400 },
		)
	}

	// Parse and validate the mediaPath
	const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
	const root = getMediaRootByName(mediaRoot)
	if (!root) {
		return Response.json(
			{ error: `Unknown media root: ${mediaRoot}` },
			{ status: 400 },
		)
	}

	if (!Array.isArray(feedIds)) {
		return Response.json(
			{ error: 'feedIds must be an array of feed IDs' },
			{ status: 400 },
		)
	}

	// Validate all feed IDs are for curated feeds
	const curatedFeeds = listCuratedFeeds()
	const curatedFeedIds = new Set(curatedFeeds.map((f) => f.id))
	const requestedFeedIds = new Set(feedIds)

	for (const feedId of feedIds) {
		if (!curatedFeedIds.has(feedId)) {
			return Response.json(
				{ error: `Feed ID "${feedId}" is not a valid curated feed` },
				{ status: 400 },
			)
		}
	}

	// Get current assignments for this file
	const currentAssignments = new Set<string>()
	for (const feed of curatedFeeds) {
		const items = getItemsForFeed(feed.id)
		if (
			items.some(
				(item) =>
					item.mediaRoot === mediaRoot && item.relativePath === relativePath,
			)
		) {
			currentAssignments.add(feed.id)
		}
	}

	// Determine additions and removals
	const toAdd = feedIds.filter((id) => !currentAssignments.has(id))
	const toRemove = [...currentAssignments].filter(
		(id) => !requestedFeedIds.has(id),
	)

	// Apply changes
	for (const feedId of toAdd) {
		// Get max position for the feed to add at the end
		const items = getItemsForFeed(feedId)
		const maxPosition = items.reduce(
			(max, item) => Math.max(max, item.position ?? 0),
			-1,
		)
		addItemToFeed(feedId, mediaRoot, relativePath, maxPosition + 1)
	}

	for (const feedId of toRemove) {
		removeItemFromFeed(feedId, mediaRoot, relativePath)
	}

	return Response.json({
		added: toAdd.length,
		removed: toRemove.length,
	})
}
