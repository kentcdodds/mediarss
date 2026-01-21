import type { Action } from 'remix/fetch-router'
import { resolveMediaPath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { type MediaFile, scanAllMediaRoots } from '#app/helpers/media.ts'

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
	narrators: string[] | null
	genres: string[] | null
	description: string | null
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
		narrators: file.narrators,
		genres: file.genres,
		description: file.description,
	}
}

/**
 * GET /admin/api/media
 * Returns all media files across all configured media roots.
 */
export default {
	middleware: [],
	async action() {
		const files = await scanAllMediaRoots()

		const items = files
			.map(toMediaItem)
			.filter((item): item is MediaItem => item !== null)

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
} satisfies Action<
	typeof routes.adminApiMedia.method,
	typeof routes.adminApiMedia.pattern.source
>
