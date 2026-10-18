import { realpath, stat } from 'node:fs/promises'
import nodePath from 'node:path'
import { number, object, optional, parseSafe, string } from 'remix/data-schema'
import { deleteCacheByPrefix } from '#app/cache/cache.ts'
import { getMediaRootByName } from '#app/config/env.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	listDirectoryFeeds,
	parseDirectoryPaths,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import { type CuratedFeed, type DirectoryFeed } from '#app/db/types.ts'
import { getDescriptionHtml } from '#app/helpers/description-html.ts'
import { type EditableMetadata, updateMetadata } from '#app/helpers/ffmpeg.ts'
import { getFileMetadata, type MediaFile } from '#app/helpers/media.ts'
import { normalizePath } from '#app/helpers/path-parsing.ts'

/**
 * Shared metadata read/edit logic for the admin metadata endpoint
 * (`PUT /admin/api/media/*path/metadata`) and the MCP metadata tools.
 */

const DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/

export function isValidYearMonthOrDate(value: string): boolean {
	const parts = value.split('-')
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
}

const NonNegativeIntegerSchema = number()
	.refine((value) => Number.isInteger(value), 'Expected an integer')
	.refine((value) => value >= 0, 'Expected a non-negative integer')

export const MetadataUpdateSchema = object({
	title: optional(string()),
	author: optional(string()),
	description: optional(string()),
	date: optional(
		string()
			.refine(
				(value) => DATE_PATTERN.test(value),
				'Date must be in YYYY, YYYY-MM, or YYYY-MM-DD format',
			)
			.refine(
				(value) => isValidYearMonthOrDate(value),
				'Date contains invalid month or day values',
			),
	),
	genre: optional(string()),
	trackNumber: optional(NonNegativeIntegerSchema),
	copyright: optional(string()),
	// Additional fields
	narrator: optional(string()),
	album: optional(string()),
	albumArtist: optional(string()),
	composer: optional(string()),
	publisher: optional(string()),
	discNumber: optional(NonNegativeIntegerSchema),
	language: optional(string()),
	series: optional(string()),
	seriesPosition: optional(string()),
	encodedBy: optional(string()),
	subtitle: optional(string()),
})

/** Field names accepted by {@link MetadataUpdateSchema}. */
export const EDITABLE_METADATA_FIELDS = [
	'title',
	'author',
	'description',
	'date',
	'genre',
	'trackNumber',
	'copyright',
	'narrator',
	'album',
	'albumArtist',
	'composer',
	'publisher',
	'discNumber',
	'language',
	'series',
	'seriesPosition',
	'encodedBy',
	'subtitle',
] as const satisfies ReadonlyArray<keyof EditableMetadata>

export type FeedAssignment = {
	feedId: string
	feedType: 'curated' | 'directory'
	feedName: string
}

export type MediaDetail = {
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
	descriptionHtml: string | null
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

export type MediaDetailResponse = {
	media: MediaDetail
	assignments: FeedAssignment[]
	curatedFeeds: Array<{
		id: string
		name: string
		updatedAt: number
	}>
	directoryFeeds: Array<{
		id: string
		name: string
		directoryPaths: string[]
		updatedAt: number
	}>
}

type Failure = { ok: false; status: number; error: string; details?: string[] }

/**
 * Resolve `rootName` + `relativePath` to an absolute file path that is
 * guaranteed to live inside the configured media root (no `..` traversal,
 * no symlink escape) and to be a regular file.
 */
export async function resolveContainedMediaFile(
	rootName: string,
	relativePath: string,
): Promise<{ ok: true; filePath: string } | Failure> {
	const root = getMediaRootByName(rootName)
	if (!root) {
		return { ok: false, status: 404, error: 'Unknown media root' }
	}
	if (!relativePath || relativePath.includes('\0')) {
		return { ok: false, status: 400, error: 'Invalid path format' }
	}

	const basePath = nodePath.resolve(root.path)
	const fullPath = nodePath.resolve(basePath, relativePath)
	if (!fullPath.startsWith(basePath + nodePath.sep)) {
		return {
			ok: false,
			status: 400,
			error: 'Invalid path: directory traversal is not allowed',
		}
	}

	let realBase: string
	let realFull: string
	try {
		realBase = await realpath(basePath)
	} catch {
		return { ok: false, status: 404, error: 'Media root is not accessible' }
	}
	try {
		realFull = await realpath(fullPath)
	} catch {
		return { ok: false, status: 404, error: 'File not found' }
	}
	if (!realFull.startsWith(realBase + nodePath.sep)) {
		return {
			ok: false,
			status: 400,
			error: 'Invalid path: directory traversal is not allowed',
		}
	}

	try {
		const info = await stat(realFull)
		if (!info.isFile()) {
			return { ok: false, status: 400, error: 'Path is not a file' }
		}
	} catch {
		return { ok: false, status: 404, error: 'File not found' }
	}

	return { ok: true, filePath: fullPath }
}

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

async function getAssignmentsForMedia(
	rootName: string,
	relativePath: string,
	curatedFeeds: CuratedFeed[],
	directoryFeeds: DirectoryFeed[],
): Promise<FeedAssignment[]> {
	const assignments: FeedAssignment[] = []
	const normalizedRelativePath = normalizePath(relativePath)
	for (const feed of curatedFeeds) {
		const items = await getItemsForFeed(feed.id)
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

export function toMediaDetail(
	metadata: MediaFile,
	rootName: string,
	relativePath: string,
): MediaDetail {
	return {
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
		descriptionHtml: getDescriptionHtml(metadata.description),
		narrators: metadata.narrators,
		genres: metadata.genres,
		copyright: metadata.copyright,
		fileModifiedAt: metadata.fileModifiedAt,
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
	}
}

async function buildMediaDetailResponse(
	metadata: MediaFile,
	rootName: string,
	relativePath: string,
): Promise<MediaDetailResponse> {
	const curatedFeeds = await listCuratedFeeds()
	const directoryFeeds = await listDirectoryFeeds()
	const assignments = await getAssignmentsForMedia(
		rootName,
		relativePath,
		curatedFeeds,
		directoryFeeds,
	)
	return {
		media: toMediaDetail(metadata, rootName, relativePath),
		assignments,
		curatedFeeds: curatedFeeds.map((f) => ({
			id: f.id,
			name: f.name,
			updatedAt: f.updatedAt,
		})),
		directoryFeeds: directoryFeeds.map((f) => ({
			id: f.id,
			name: f.name,
			directoryPaths: parseDirectoryPaths(f),
			updatedAt: f.updatedAt,
		})),
	}
}

/**
 * Read the full metadata for one media file inside a configured media root.
 */
export async function readMediaMetadata(
	rootName: string,
	relativePath: string,
): Promise<{ ok: true; detail: MediaDetail } | Failure> {
	const resolved = await resolveContainedMediaFile(rootName, relativePath)
	if (!resolved.ok) return resolved
	const metadata = await getFileMetadata(resolved.filePath)
	if (!metadata) {
		return {
			ok: false,
			status: 404,
			error: 'File not found or not a media file',
		}
	}
	return { ok: true, detail: toMediaDetail(metadata, rootName, relativePath) }
}

/**
 * Validate a metadata update and write it to the file's tags with FFmpeg
 * (atomic replace), then invalidate the metadata cache and return the
 * re-read metadata. Fields omitted from `update` are left untouched.
 */
export async function applyMediaMetadataUpdate(
	rootName: string,
	relativePath: string,
	update: unknown,
): Promise<{ ok: true; response: MediaDetailResponse } | Failure> {
	const resolved = await resolveContainedMediaFile(rootName, relativePath)
	if (!resolved.ok) return resolved
	const { filePath } = resolved

	const currentMetadata = await getFileMetadata(filePath)
	if (!currentMetadata) {
		return {
			ok: false,
			status: 404,
			error: 'File not found or not a media file',
		}
	}

	const parseResult = parseSafe(MetadataUpdateSchema, update)
	if (!parseResult.success) {
		return {
			ok: false,
			status: 400,
			error: 'Invalid metadata',
			details: parseResult.issues.map((issue) => issue.message),
		}
	}

	const metadataUpdate = parseResult.value
	const editableMetadata: EditableMetadata = {}
	for (const field of EDITABLE_METADATA_FIELDS) {
		const value = metadataUpdate[field]
		if (value !== undefined) {
			;(editableMetadata as Record<string, unknown>)[field] = value
		}
	}

	if (Object.keys(editableMetadata).length === 0) {
		return { ok: false, status: 400, error: 'No metadata fields provided' }
	}

	try {
		await updateMetadata(filePath, currentMetadata.mimeType, editableMetadata)
	} catch (error) {
		console.error('FFmpeg metadata update failed:', error)
		return {
			ok: false,
			status: 500,
			error:
				error instanceof Error ? error.message : 'Failed to update metadata',
		}
	}

	await deleteCacheByPrefix(`media:${filePath}`)

	const updatedMetadata = await getFileMetadata(filePath)
	if (!updatedMetadata) {
		return {
			ok: false,
			status: 500,
			error: 'Failed to read updated metadata',
		}
	}

	return {
		ok: true,
		response: await buildMediaDetailResponse(
			updatedMetadata,
			rootName,
			relativePath,
		),
	}
}
