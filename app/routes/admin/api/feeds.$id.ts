import fs from 'node:fs'
import type { Action } from 'remix/fetch-router'
import {
	getMediaRootByName,
	parseMediaPath,
	resolveMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
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
import { reorderFeedItems } from '#app/db/feed-items.ts'
import type { SortOrder } from '#app/db/types.ts'
import { deleteFeedArtwork, hasFeedArtwork } from '#app/helpers/feed-artwork.ts'
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
	mediaRoot: string
	relativePath: string
	publicationDate: string | null // ISO string
	trackNumber: number | null
	fileModifiedAt: number // Unix timestamp
}

type UpdateFeedRequest = {
	name?: string
	description?: string
	subtitle?: string | null
	sortFields?: string
	sortOrder?: SortOrder
	directoryPaths?: Array<string> // Only for directory feeds - array of "mediaRoot:relativePath" strings
	imageUrl?: string | null // External artwork URL
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
		const items: Array<MediaItemResponse> = []
		for (const file of mediaFiles) {
			const resolved = resolveMediaPath(file.path)
			if (resolved) {
				items.push({
					title: file.title,
					author: file.author,
					duration: file.duration,
					sizeBytes: file.sizeBytes,
					filename: file.filename,
					mediaRoot: resolved.root.name,
					relativePath: resolved.relativePath,
					publicationDate: file.publicationDate?.toISOString() ?? null,
					trackNumber: file.trackNumber,
					fileModifiedAt: file.fileModifiedAt,
				})
			}
		}

		const hasUploadedArtwork = await hasFeedArtwork(directoryFeed.id)

		return Response.json({
			feed: { ...directoryFeed, type: 'directory' as const },
			tokens,
			items,
			hasUploadedArtwork,
		})
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		const tokens = listActiveCuratedFeedTokens(curatedFeed.id)
		const mediaFiles = await getCuratedFeedItems(curatedFeed)
		const items: Array<MediaItemResponse> = []
		for (const file of mediaFiles) {
			const resolved = resolveMediaPath(file.path)
			if (resolved) {
				items.push({
					title: file.title,
					author: file.author,
					duration: file.duration,
					sizeBytes: file.sizeBytes,
					filename: file.filename,
					mediaRoot: resolved.root.name,
					relativePath: resolved.relativePath,
					publicationDate: file.publicationDate?.toISOString() ?? null,
					trackNumber: file.trackNumber,
					fileModifiedAt: file.fileModifiedAt,
				})
			}
		}

		const hasUploadedArtwork = await hasFeedArtwork(curatedFeed.id)

		return Response.json({
			feed: { ...curatedFeed, type: 'curated' as const },
			tokens,
			items,
			hasUploadedArtwork,
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

	// Validate feedType if provided
	if (body.feedType && !['episodic', 'serial'].includes(body.feedType)) {
		return Response.json(
			{ error: 'feedType must be "episodic" or "serial"' },
			{ status: 400 },
		)
	}

	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) {
		// Validate directoryPaths if provided
		let validatedPaths: Array<string> | undefined
		if (body.directoryPaths !== undefined) {
			if (
				!Array.isArray(body.directoryPaths) ||
				body.directoryPaths.length === 0
			) {
				return Response.json(
					{ error: 'directoryPaths must be a non-empty array' },
					{ status: 400 },
				)
			}

			validatedPaths = []
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
		}

		const updated = updateDirectoryFeed(id, {
			name: body.name,
			description: body.description,
			subtitle: body.subtitle,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
			directoryPaths: validatedPaths,
			imageUrl: body.imageUrl,
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

		if (!updated) {
			return Response.json({ error: 'Failed to update feed' }, { status: 500 })
		}

		return Response.json({ ...updated, type: 'directory' as const })
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		// Curated feeds don't have directoryPaths
		if (body.directoryPaths !== undefined) {
			return Response.json(
				{ error: 'Cannot set directoryPaths on a curated feed' },
				{ status: 400 },
			)
		}

		// If switching to manual sort (position), preserve the current order
		// by setting position values based on the current sorted order
		const switchingToManualSort =
			body.sortFields === 'position' && curatedFeed.sortFields !== 'position'

		if (switchingToManualSort) {
			// Get items in their current sorted order (before changing sort)
			const items = await getCuratedFeedItems(curatedFeed)

			// Set positions for each item to preserve the current order
			const reorderItems = items
				.map((item) => {
					const resolved = resolveMediaPath(item.path)
					if (!resolved) return null
					return {
						mediaRoot: resolved.root.name,
						relativePath: resolved.relativePath,
					}
				})
				.filter(
					(item): item is { mediaRoot: string; relativePath: string } =>
						item !== null,
				)

			reorderFeedItems(curatedFeed.id, reorderItems)
		}

		const updated = updateCuratedFeed(id, {
			name: body.name,
			description: body.description,
			subtitle: body.subtitle,
			sortFields: body.sortFields,
			sortOrder: body.sortOrder,
			imageUrl: body.imageUrl,
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

		if (!updated) {
			return Response.json({ error: 'Failed to update feed' }, { status: 500 })
		}

		return Response.json({ ...updated, type: 'curated' as const })
	}

	return Response.json({ error: 'Feed not found' }, { status: 404 })
}

async function handleDelete(id: string) {
	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(id)
	if (directoryFeed) {
		// Delete uploaded artwork first
		await deleteFeedArtwork(id)
		const deleted = deleteDirectoryFeed(id)
		if (!deleted) {
			return Response.json({ error: 'Failed to delete feed' }, { status: 500 })
		}
		return new Response(null, { status: 204 })
	}

	// Try curated feed
	const curatedFeed = getCuratedFeedById(id)
	if (curatedFeed) {
		// Delete uploaded artwork first
		await deleteFeedArtwork(id)
		const deleted = deleteCuratedFeed(id)
		if (!deleted) {
			return Response.json({ error: 'Failed to delete feed' }, { status: 500 })
		}
		return new Response(null, { status: 204 })
	}

	return Response.json({ error: 'Feed not found' }, { status: 404 })
}
