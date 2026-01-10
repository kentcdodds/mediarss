import type { Action } from '@remix-run/fetch-router'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	listDirectoryFeeds,
	parseDirectoryPaths,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed } from '#app/db/types.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { normalizePath, parseMediaPath } from '#app/helpers/path-parsing.ts'

type FeedAssignment = {
	feedId: string
	feedType: 'curated' | 'directory'
	feedName: string
}

type MediaDetailResponse = {
	media: {
		path: string
		rootName: string
		relativePath: string
		filename: string
		title: string
		author: string | null
		duration: number | null
		sizeBytes: number
		mimeType: string
		publicationDate: string | null
		trackNumber: number | null
		description: string | null
		narrators: string[] | null
		genres: string[] | null
		copyright: string | null
		fileModifiedAt: number
		// Additional metadata fields
		album: string | null
		albumArtist: string | null
		composer: string | null
		publisher: string | null
		discNumber: number | null
		totalDiscs: number | null
		totalTracks: number | null
		language: string | null
		series: string | null
		seriesPosition: string | null
		encodedBy: string | null
		subtitle: string | null
	}
	assignments: FeedAssignment[]
	curatedFeeds: Array<{ id: string; name: string; imageUrl: string | null }>
	directoryFeeds: Array<{
		id: string
		name: string
		directoryPaths: string[]
		imageUrl: string | null
	}>
}

/**
 * Check if a media file is within any of the directory paths for a feed.
 */
function isMediaInDirectoryFeed(
	rootName: string,
	relativePath: string,
	feed: DirectoryFeed,
): boolean {
	const paths = parseDirectoryPaths(feed)
	const normalizedFile = `${rootName}:${normalizePath(relativePath)}`

	for (const dirPath of paths) {
		const normalizedDir = normalizePath(dirPath)

		if (
			normalizedFile.startsWith(normalizedDir + '/') ||
			normalizedFile === normalizedDir ||
			normalizedFile.startsWith(normalizedDir)
		) {
			return true
		}
	}
	return false
}

/**
 * Get all feed assignments for a media file.
 */
function getAssignmentsForMedia(
	rootName: string,
	relativePath: string,
	curatedFeeds: CuratedFeed[],
	directoryFeeds: DirectoryFeed[],
): FeedAssignment[] {
	const assignments: FeedAssignment[] = []

	// Check curated feed assignments
	for (const feed of curatedFeeds) {
		const items = getItemsForFeed(feed.id)
		if (
			items.some(
				(item) =>
					item.mediaRoot === rootName && item.relativePath === relativePath,
			)
		) {
			assignments.push({
				feedId: feed.id,
				feedType: 'curated',
				feedName: feed.name,
			})
		}
	}

	// Check directory feed matches
	for (const feed of directoryFeeds) {
		if (isMediaInDirectoryFeed(rootName, relativePath, feed)) {
			assignments.push({
				feedId: feed.id,
				feedType: 'directory',
				feedName: feed.name,
			})
		}
	}

	return assignments
}

/**
 * GET /admin/api/media/*path
 * Returns detailed metadata for a single media file.
 */
export default {
	middleware: [],
	async action(context) {
		const { path: splatParam } = context.params

		if (!splatParam) {
			return Response.json({ error: 'Path required' }, { status: 400 })
		}

		// Decode the path parameter
		const decodedPath = decodeURIComponent(splatParam)

		// Parse root name and relative path from URL
		const parsed = parseMediaPath(decodedPath)
		if (!parsed) {
			return Response.json({ error: 'Invalid path format' }, { status: 400 })
		}

		const { rootName, relativePath } = parsed

		// Convert to absolute file path
		const filePath = toAbsolutePath(rootName, relativePath)
		if (!filePath) {
			return Response.json({ error: 'Unknown media root' }, { status: 404 })
		}

		// Get file metadata
		const metadata = await getFileMetadata(filePath)
		if (!metadata) {
			return Response.json(
				{ error: 'File not found or not a media file' },
				{ status: 404 },
			)
		}

		// Get feeds and assignments
		const curatedFeeds = listCuratedFeeds()
		const directoryFeeds = listDirectoryFeeds()
		const assignments = getAssignmentsForMedia(
			rootName,
			relativePath,
			curatedFeeds,
			directoryFeeds,
		)

		const response: MediaDetailResponse = {
			media: {
				path: metadata.path,
				rootName,
				relativePath,
				filename: metadata.filename,
				title: metadata.title,
				author: metadata.author,
				duration: metadata.duration,
				sizeBytes: metadata.sizeBytes,
				mimeType: metadata.mimeType,
				publicationDate: metadata.publicationDate?.toISOString() ?? null,
				trackNumber: metadata.trackNumber,
				description: metadata.description,
				narrators: metadata.narrators,
				genres: metadata.genres,
				copyright: metadata.copyright,
				fileModifiedAt: metadata.fileModifiedAt,
				// Additional metadata fields
				album: metadata.album,
				albumArtist: metadata.albumArtist,
				composer: metadata.composer,
				publisher: metadata.publisher,
				discNumber: metadata.discNumber,
				totalDiscs: metadata.totalDiscs,
				totalTracks: metadata.totalTracks,
				language: metadata.language,
				series: metadata.series,
				seriesPosition: metadata.seriesPosition,
				encodedBy: metadata.encodedBy,
				subtitle: metadata.subtitle,
			},
			assignments,
			curatedFeeds: curatedFeeds.map((f) => ({
				id: f.id,
				name: f.name,
				imageUrl: f.imageUrl,
				updatedAt: f.updatedAt,
			})),
			directoryFeeds: directoryFeeds.map((f) => ({
				id: f.id,
				name: f.name,
				directoryPaths: JSON.parse(f.directoryPaths) as string[],
				imageUrl: f.imageUrl,
				updatedAt: f.updatedAt,
			})),
		}

		return Response.json(response)
	},
} satisfies Action<
	typeof routes.adminApiMediaDetail.method,
	typeof routes.adminApiMediaDetail.pattern.source
>
