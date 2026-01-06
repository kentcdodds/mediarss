import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import {
	addItemToFeed,
	getItemsForFeed,
	removeItemFromFeed,
	reorderFeedItems,
} from '#app/db/feed-items.ts'

type AddItemsRequest = {
	items: Array<string>
}

type RemoveItemsRequest = {
	items: Array<string>
}

type ReorderItemsRequest = {
	order: Array<string>
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
			return Response.json(
				{ error: 'Curated feed not found' },
				{ status: 404 },
			)
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
} satisfies Action<
	typeof routes.adminApiFeedItems.method,
	typeof routes.adminApiFeedItems.pattern.source
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
			{ error: 'Items must be a non-empty array of file paths' },
			{ status: 400 },
		)
	}

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
				{ error: `File path must be within a configured media root: ${filePath}` },
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

	// Get current items to determine position for new items
	const currentItems = getItemsForFeed(feedId)
	const maxPosition = currentItems.reduce(
		(max, item) => Math.max(max, item.position ?? 0),
		-1,
	)

	// Add items with sequential positions after existing items
	const addedItems = []
	for (let i = 0; i < validatedPaths.length; i++) {
		const path = validatedPaths[i]
		if (path) {
			const item = addItemToFeed(feedId, path, maxPosition + 1 + i)
			addedItems.push(item)
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
			{ error: 'Items must be a non-empty array of file paths' },
			{ status: 400 },
		)
	}

	let removedCount = 0
	for (const filePath of body.items) {
		if (typeof filePath === 'string' && filePath.trim()) {
			const removed = removeItemFromFeed(feedId, filePath)
			if (removed) removedCount++
		}
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
			{ error: 'Order must be an array of file paths' },
			{ status: 400 },
		)
	}

	// Validate that all paths in the order exist in the feed
	const currentItems = getItemsForFeed(feedId)
	const currentPaths = new Set(currentItems.map((item) => item.filePath))

	for (const path of body.order) {
		if (!currentPaths.has(path)) {
			return Response.json(
				{ error: `File path not in feed: ${path}` },
				{ status: 400 },
			)
		}
	}

	reorderFeedItems(feedId, body.order)

	return Response.json({ reordered: body.order.length })
}
