import type { Action } from '@remix-run/fetch-router'
import type routes from '#app/config/routes.ts'
import { listActiveCuratedFeedTokens } from '#app/db/curated-feed-tokens.ts'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import { listDirectoryFeedTokens } from '#app/db/directory-feed-tokens.ts'
import { getDirectoryFeedById } from '#app/db/directory-feeds.ts'
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

/**
 * GET /admin/api/feeds/:id
 * Returns a single feed with its tokens and media items.
 */
export default {
	middleware: [],
	async action(context) {
		const { id } = context.params

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
	},
} satisfies Action<
	typeof routes.adminApiFeed.method,
	typeof routes.adminApiFeed.pattern.source
>
