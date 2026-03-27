import type { BuildAction } from 'remix/fetch-router'
import { resolveMediaPath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listMediaPopularityMetrics } from '#app/db/feed-analytics-events.ts'
import { type MediaFile, scanAllMediaRoots } from '#app/helpers/media.ts'
import { createMediaKey } from '#app/helpers/path-parsing.ts'

type MediaItem = {
	path: string
	rootName: string
	relativePath: string
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	filename: string
	publicationDate: string | null
	fileModifiedAt: number
	narrators: string[] | null
	genres: string[] | null
	description: string | null
	popularityScore: number
	downloadStarts: number
	mediaRequests: number
	uniqueClients: number
	lastPlayedAt: number | null
}

/**
 * Convert a MediaFile to a MediaItem for the API response.
 */
function toMediaItem(file: MediaFile): MediaItem | null {
	const resolved = resolveMediaPath(file.path)
	if (!resolved) return null

	return {
		path: file.path,
		rootName: resolved.root.name,
		relativePath: resolved.relativePath,
		title: file.title,
		author: file.author,
		duration: file.duration,
		sizeBytes: file.sizeBytes,
		filename: file.filename,
		publicationDate: file.publicationDate?.toISOString() ?? null,
		fileModifiedAt: file.fileModifiedAt,
		narrators: file.narrators,
		genres: file.genres,
		description: file.description,
		popularityScore: 0,
		downloadStarts: 0,
		mediaRequests: 0,
		uniqueClients: 0,
		lastPlayedAt: null,
	}
}

/**
 * GET /admin/api/media
 * Returns all media files across all configured media roots.
 */
export default {
	middleware: [],
	async handler() {
		const files = await scanAllMediaRoots()
		const popularityByMediaKey = listMediaPopularityMetrics()

		const items = files
			.map(toMediaItem)
			.filter((item): item is MediaItem => item !== null)
			.map((item) => {
				const popularity = popularityByMediaKey.get(
					createMediaKey(item.rootName, item.relativePath),
				)
				return {
					...item,
					popularityScore:
						(popularity?.downloadStarts ?? 0) * 100 +
						(popularity?.mediaRequests ?? 0),
					downloadStarts: popularity?.downloadStarts ?? 0,
					mediaRequests: popularity?.mediaRequests ?? 0,
					uniqueClients: popularity?.uniqueClients ?? 0,
					lastPlayedAt: popularity?.lastSeenAt ?? null,
				}
			})

		// Sort by publication date (newest first), items without date go to end
		items.sort((a, b) => {
			if (!a.publicationDate && !b.publicationDate) {
				return a.title.localeCompare(b.title) // fallback to title
			}
			if (!a.publicationDate) return 1
			if (!b.publicationDate) return -1
			return b.publicationDate.localeCompare(a.publicationDate)
		})

		return Response.json({ items })
	},
} satisfies BuildAction<
	typeof routes.adminApiMedia.method,
	typeof routes.adminApiMedia.pattern
>
