import fs from 'node:fs'
import type { BuildAction } from 'remix/fetch-router'
import {
	getMediaRootByName,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import {
	addItemToFeed,
	getItemsForFeed,
	type ReorderItem,
	removeItemFromFeed,
	reorderFeedItems,
} from '#app/db/feed-items.ts'

type AddItemsRequest = {
	items: Array<string> // Array of "mediaRoot:relativePath" strings
}

type RemoveItemsRequest = {
	items: Array<string> // Array of "mediaRoot:relativePath" strings
}

type ReorderItemsRequest = {
	order: Array<string> // Array of "mediaRoot:relativePath" strings
}

/**
 * POST /admin/api/feeds/:id/items - Add items to a curated feed
 * DELETE /admin/api/feeds/:id/items - Remove items from a curated feed
 * PATCH /admin/api/feeds/:id/items - Reorder items in a curated feed
 */
export default {
	middleware: [],
	async action(context) {
		const { id } = context.params

		// Only curated feeds support item management
		const feed = getCuratedFeedById(id)
		if (!feed) {
			return Response.json({ error: 'Curated feed not found' }, { status: 404 })
		}

		if (context.method === 'POST') {
			return handleAddItems(feed.id, context.request)
		}

		if (context.method === 'DELETE') {
			return handleRemoveItems(feed.id, context.request)
		}

		if (context.method === 'PATCH') {
			return handleReorderItems(feed.id, context.request)
		}

		return Response.json({ error: 'Method not allowed' }, { status: 405 })
	},
} satisfies BuildAction<
	typeof routes.adminApiFeedItems.method,
	typeof routes.adminApiFeedItems.pattern
>

async function handleAddItems(feedId: string, request: Request) {
	let body: AddItemsRequest
	try {
		body = await request.json()
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	if (!Array.isArray(body.items) || body.items.length === 0) {
		return Response.json(
			{
				error:
					'Items must be a non-empty array of mediaRoot:relativePath strings',
			},
			{ status: 400 },
		)
	}

	const validatedItems: Array<{ mediaRoot: string; relativePath: string }> = []

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

	// Get current items to determine position for new items
	const currentItems = getItemsForFeed(feedId)
	const maxPosition = currentItems.reduce(
		(max, item) => Math.max(max, item.position ?? 0),
		-1,
	)

	// Add items with sequential positions after existing items
	const addedItems = []
	for (let i = 0; i < validatedItems.length; i++) {
		const item = validatedItems[i]
		if (item) {
			const feedItem = addItemToFeed(
				feedId,
				item.mediaRoot,
				item.relativePath,
				maxPosition + 1 + i,
			)
			addedItems.push(feedItem)
		}
	}

	return Response.json({ added: addedItems.length }, { status: 201 })
}

async function handleRemoveItems(feedId: string, request: Request) {
	let body: RemoveItemsRequest
	try {
		body = await request.json()
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	if (!Array.isArray(body.items) || body.items.length === 0) {
		return Response.json(
			{
				error:
					'Items must be a non-empty array of mediaRoot:relativePath strings',
			},
			{ status: 400 },
		)
	}

	let removedCount = 0
	for (const mediaPath of body.items) {
		if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
			continue
		}

		const { mediaRoot, relativePath } = parseMediaPath(mediaPath)

		// Validate media root exists
		const root = getMediaRootByName(mediaRoot)
		if (!root) continue

		const removed = removeItemFromFeed(feedId, mediaRoot, relativePath)
		if (removed) removedCount++
	}

	return Response.json({ removed: removedCount })
}

async function handleReorderItems(feedId: string, request: Request) {
	let body: ReorderItemsRequest
	try {
		body = await request.json()
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	if (!Array.isArray(body.order)) {
		return Response.json(
			{ error: 'Order must be an array of mediaRoot:relativePath strings' },
			{ status: 400 },
		)
	}

	// Validate that all items in the order exist in the feed
	const currentItems = getItemsForFeed(feedId)
	const currentItemSet = new Set(
		currentItems.map((item) => `${item.mediaRoot}:${item.relativePath}`),
	)

	const orderItems: Array<ReorderItem> = []
	for (const mediaPath of body.order) {
		if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
			return Response.json(
				{
					error:
						'Each order item must be a non-empty string in mediaRoot:relativePath format',
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

		const key = `${mediaRoot}:${relativePath}`
		if (!currentItemSet.has(key)) {
			return Response.json(
				{ error: `Item not in feed: ${mediaPath}` },
				{ status: 400 },
			)
		}

		orderItems.push({ mediaRoot, relativePath })
	}

	reorderFeedItems(feedId, orderItems)

	return Response.json({ reordered: orderItems.length })
}
