import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import {
	getCuratedFeedById,
	updateCuratedFeed,
} from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import type { CuratedFeed, DirectoryFeed } from '#app/db/types.ts'
import {
	deleteFeedArtwork,
	getFeedArtworkPath,
	hasFeedArtwork,
	saveFeedArtwork,
} from '#app/helpers/feed-artwork.ts'

/**
 * GET /admin/api/feeds/:id/artwork
 * Returns artwork for a feed with fallbacks:
 * 1. Uploaded artwork (if exists)
 * 2. External imageUrl (redirect)
 * 3. Generated placeholder SVG
 *
 * POST /admin/api/feeds/:id/artwork
 * Uploads new artwork for a feed (multipart/form-data with 'file' field).
 *
 * DELETE /admin/api/feeds/:id/artwork
 * Deletes uploaded artwork for a feed.
 */
export default {
	middleware: [],
	async action(context) {
		const { id } = context.params

		// Verify feed exists
		const directoryFeed = getDirectoryFeedById(id)
		const curatedFeed = !directoryFeed ? getCuratedFeedById(id) : null
		const feed = directoryFeed ?? curatedFeed

		if (!feed) {
			return Response.json({ error: 'Feed not found' }, { status: 404 })
		}

		if (context.method === 'GET') {
			return handleGet(id, feed)
		}

		if (context.method === 'POST') {
			return handlePost(id, context.request)
		}

		if (context.method === 'DELETE') {
			return handleDelete(id)
		}

		return Response.json({ error: 'Method not allowed' }, { status: 405 })
	},
} satisfies Action<
	typeof routes.adminApiFeedArtwork.method,
	typeof routes.adminApiFeedArtwork.pattern.source
>

async function handleGet(feedId: string, feed: DirectoryFeed | CuratedFeed) {
	// Priority 1: Uploaded artwork
	const artwork = await getFeedArtworkPath(feedId)
	if (artwork) {
		const file = Bun.file(artwork.path)
		return new Response(file.stream(), {
			headers: {
				'Content-Type': artwork.mimeType,
				'Cache-Control': 'public, max-age=86400',
			},
		})
	}

	// Priority 2: External imageUrl (redirect)
	if (feed.imageUrl) {
		return Response.redirect(feed.imageUrl, 302)
	}

	// Priority 3: Generated placeholder SVG
	const svg = generatePlaceholderSvg(feed.name)
	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=86400',
		},
	})
}

/**
 * Generate a simple placeholder SVG with the feed's first letter
 */
function generatePlaceholderSvg(name: string): string {
	const letter = name.trim()[0]?.toUpperCase() ?? '?'
	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
		<rect width="200" height="200" fill="#1a1a2e"/>
		<text x="100" y="120" font-family="system-ui, sans-serif" font-size="80" font-weight="bold" fill="#e94560" text-anchor="middle">${letter}</text>
	</svg>`
}

/**
 * Touch the feed's updated_at timestamp.
 * This is needed when artwork changes since artwork is stored separately.
 */
function touchFeedUpdatedAt(feedId: string): void {
	// Try directory feed first
	const directoryFeed = getDirectoryFeedById(feedId)
	if (directoryFeed) {
		updateDirectoryFeed(feedId, {})
		return
	}
	// Try curated feed
	const curatedFeed = getCuratedFeedById(feedId)
	if (curatedFeed) {
		updateCuratedFeed(feedId, {})
	}
}

async function handlePost(feedId: string, request: Request) {
	const contentType = request.headers.get('content-type') ?? ''

	if (!contentType.includes('multipart/form-data')) {
		return Response.json(
			{ error: 'Content-Type must be multipart/form-data' },
			{ status: 400 },
		)
	}

	let formData: FormData
	try {
		formData = await request.formData()
	} catch {
		return Response.json({ error: 'Invalid form data' }, { status: 400 })
	}

	const file = formData.get('file')

	if (!file || !(file instanceof File)) {
		return Response.json(
			{ error: 'Missing file field in form data' },
			{ status: 400 },
		)
	}

	const result = await saveFeedArtwork(feedId, file)

	if (result.error) {
		return Response.json({ error: result.error }, { status: 400 })
	}

	// Update the feed's updated_at timestamp since artwork changed
	touchFeedUpdatedAt(feedId)

	return Response.json({
		success: true,
		hasUploadedArtwork: true,
	})
}

async function handleDelete(feedId: string) {
	const hasArtwork = await hasFeedArtwork(feedId)

	if (!hasArtwork) {
		return Response.json(
			{ error: 'No uploaded artwork to delete' },
			{ status: 404 },
		)
	}

	const deleted = await deleteFeedArtwork(feedId)

	if (!deleted) {
		return Response.json({ error: 'Failed to delete artwork' }, { status: 500 })
	}

	// Update the feed's updated_at timestamp since artwork changed
	touchFeedUpdatedAt(feedId)

	return Response.json({
		success: true,
		hasUploadedArtwork: false,
	})
}
