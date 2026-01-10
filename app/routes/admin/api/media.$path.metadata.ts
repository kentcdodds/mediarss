import type { Action } from '@remix-run/fetch-router'
import { z } from 'zod'
import { deleteCacheByPrefix } from '#app/cache/cache.ts'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	listDirectoryFeeds,
	parseDirectoryPaths,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import type { CuratedFeed, DirectoryFeed } from '#app/db/types.ts'
import { type EditableMetadata, updateMetadata } from '#app/helpers/ffmpeg.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { normalizePath, parseMediaPath } from '#app/helpers/path-parsing.ts'

/**
 * Request body schema for metadata updates.
 */
const MetadataUpdateSchema = z.object({
	title: z.string().optional(),
	author: z.string().optional(),
	description: z.string().optional(),
	date: z
		.string()
		.regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, {
			message: 'Date must be in YYYY, YYYY-MM, or YYYY-MM-DD format',
		})
		.refine(
			(val) => {
				const parts = val.split('-')
				if (parts.length === 1) return true // YYYY only
				const month = parseInt(parts[1]!, 10)
				if (month < 1 || month > 12) return false
				if (parts.length === 2) return true // YYYY-MM
				// Validate full date using Date constructor (handles month lengths and leap years)
				const year = parseInt(parts[0]!, 10)
				const day = parseInt(parts[2]!, 10)
				const testDate = new Date(year, month - 1, day)
				return (
					testDate.getFullYear() === year &&
					testDate.getMonth() === month - 1 &&
					testDate.getDate() === day
				)
			},
			{ message: 'Date contains invalid month or day values' },
		)
		.optional(),
	genre: z.string().optional(),
	trackNumber: z.number().int().min(0).optional(),
	copyright: z.string().optional(),
	// Additional fields
	narrator: z.string().optional(),
	album: z.string().optional(),
	albumArtist: z.string().optional(),
	composer: z.string().optional(),
	publisher: z.string().optional(),
	discNumber: z.number().int().min(0).optional(),
	language: z.string().optional(),
	series: z.string().optional(),
	seriesPosition: z.string().optional(),
	encodedBy: z.string().optional(),
	subtitle: z.string().optional(),
})

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
	curatedFeeds: Array<{
		id: string
		name: string
		imageUrl: string | null
		updatedAt: number
	}>
	directoryFeeds: Array<{
		id: string
		name: string
		directoryPaths: string[]
		imageUrl: string | null
		updatedAt: number
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
			normalizedFile === normalizedDir
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
	const normalizedRelativePath = normalizePath(relativePath)
	for (const feed of curatedFeeds) {
		const items = getItemsForFeed(feed.id)
		if (
			items.some(
				(item) =>
					item.mediaRoot === rootName &&
					item.relativePath === normalizedRelativePath,
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
 * PUT /admin/api/media/*path/metadata
 * Updates metadata for a single media file using FFmpeg.
 * Returns the updated MediaDetailResponse.
 */
export default {
	middleware: [],
	async action(context) {
		// Only allow PUT requests
		if (context.request.method !== 'PUT') {
			return Response.json(
				{ error: 'Method not allowed' },
				{ status: 405, headers: { Allow: 'PUT' } },
			)
		}

		const { path: splatParam } = context.params

		if (!splatParam) {
			return Response.json({ error: 'Path required' }, { status: 400 })
		}

		// Remove trailing /metadata from the path
		const pathWithoutMetadata = splatParam.replace(/\/metadata$/, '')

		// Decode the path parameter
		const decodedPath = decodeURIComponent(pathWithoutMetadata)

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

		// Get current file metadata to verify it exists and get MIME type
		const currentMetadata = await getFileMetadata(filePath)
		if (!currentMetadata) {
			return Response.json(
				{ error: 'File not found or not a media file' },
				{ status: 404 },
			)
		}

		// Parse request body
		let body: unknown
		try {
			body = await context.request.json()
		} catch {
			return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
		}

		// Validate request body
		const parseResult = MetadataUpdateSchema.safeParse(body)
		if (!parseResult.success) {
			return Response.json(
				{
					error: 'Invalid metadata',
					details: parseResult.error.issues.map((i) => i.message),
				},
				{ status: 400 },
			)
		}

		const metadataUpdate = parseResult.data

		// Check if there's anything to update
		if (Object.keys(metadataUpdate).length === 0) {
			return Response.json(
				{ error: 'No metadata fields provided' },
				{ status: 400 },
			)
		}

		// Update metadata using FFmpeg
		try {
			const editableMetadata: EditableMetadata = {
				title: metadataUpdate.title,
				author: metadataUpdate.author,
				description: metadataUpdate.description,
				date: metadataUpdate.date,
				genre: metadataUpdate.genre,
				trackNumber: metadataUpdate.trackNumber,
				copyright: metadataUpdate.copyright,
				narrator: metadataUpdate.narrator,
				album: metadataUpdate.album,
				albumArtist: metadataUpdate.albumArtist,
				composer: metadataUpdate.composer,
				publisher: metadataUpdate.publisher,
				discNumber: metadataUpdate.discNumber,
				language: metadataUpdate.language,
				series: metadataUpdate.series,
				seriesPosition: metadataUpdate.seriesPosition,
				encodedBy: metadataUpdate.encodedBy,
				subtitle: metadataUpdate.subtitle,
			}

			await updateMetadata(filePath, currentMetadata.mimeType, editableMetadata)
		} catch (error) {
			console.error('FFmpeg metadata update failed:', error)
			return Response.json(
				{
					error:
						error instanceof Error
							? error.message
							: 'Failed to update metadata',
				},
				{ status: 500 },
			)
		}

		// Invalidate cache for this file
		const cacheKey = `media:${filePath}`
		deleteCacheByPrefix(cacheKey)

		// Re-fetch metadata to get updated values
		const updatedMetadata = await getFileMetadata(filePath)
		if (!updatedMetadata) {
			return Response.json(
				{ error: 'Failed to read updated metadata' },
				{ status: 500 },
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
				path: updatedMetadata.path,
				rootName,
				relativePath,
				filename: updatedMetadata.filename,
				title: updatedMetadata.title,
				author: updatedMetadata.author,
				duration: updatedMetadata.duration,
				sizeBytes: updatedMetadata.sizeBytes,
				mimeType: updatedMetadata.mimeType,
				publicationDate: updatedMetadata.publicationDate?.toISOString() ?? null,
				trackNumber: updatedMetadata.trackNumber,
				description: updatedMetadata.description,
				narrators: updatedMetadata.narrators,
				genres: updatedMetadata.genres,
				copyright: updatedMetadata.copyright,
				fileModifiedAt: updatedMetadata.fileModifiedAt,
				// Additional metadata fields
				album: updatedMetadata.album,
				albumArtist: updatedMetadata.albumArtist,
				composer: updatedMetadata.composer,
				publisher: updatedMetadata.publisher,
				discNumber: updatedMetadata.discNumber,
				totalDiscs: updatedMetadata.totalDiscs,
				totalTracks: updatedMetadata.totalTracks,
				language: updatedMetadata.language,
				series: updatedMetadata.series,
				seriesPosition: updatedMetadata.seriesPosition,
				encodedBy: updatedMetadata.encodedBy,
				subtitle: updatedMetadata.subtitle,
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
				directoryPaths: parseDirectoryPaths(f),
				imageUrl: f.imageUrl,
				updatedAt: f.updatedAt,
			})),
		}

		return Response.json(response)
	},
} satisfies Action<
	typeof routes.adminApiMediaMetadata.method,
	typeof routes.adminApiMediaMetadata.pattern.source
>
