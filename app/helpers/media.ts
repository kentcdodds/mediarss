import fs from 'node:fs'
import path from 'node:path'
import { invariant } from '@epic-web/invariant'
import { fileTypeFromFile } from 'file-type'
import * as mm from 'music-metadata'
import pLimit from 'p-limit'
import { z } from 'zod'
import { cachified, shouldRefreshCache } from '#app/cache/cache.ts'
import { getMediaRoots } from '#app/config/env.ts'

/**
 * Concurrency limit for parallel metadata extraction.
 * Limits how many files are processed simultaneously to avoid overwhelming I/O.
 */
const metadataLimit = pLimit(10)

/**
 * Directories to skip when scanning (Synology NAS junk, macOS metadata, etc.)
 */
const IGNORED_DIRECTORIES = new Set([
	'@eaDir',
	'#recycle',
	'.DS_Store',
	'@Recycle',
	'.Spotlight-V100',
	'.fseventsd',
	'.Trashes',
])

/**
 * Schema for validating MediaFile data
 */
const MediaFileSchema = z.object({
	path: z.string(),
	filename: z.string(),
	directory: z.string(),
	title: z.string(),
	author: z.string().nullable(),
	duration: z.number().nullable(),
	publicationDate: z.date().nullable(),
	trackNumber: z.number().nullable(),
	description: z.string().nullable(),
	sizeBytes: z.number(),
	mimeType: z.string(),
	fileModifiedAt: z.number(),
})

export type MediaFile = z.infer<typeof MediaFileSchema>

/**
 * Schema for cached media file data (handles Date serialization).
 * Derived from MediaFileSchema with publicationDate as ISO string instead of Date.
 */
const CachedMediaFileSchema = MediaFileSchema.omit({ publicationDate: true }).extend({
	publicationDate: z.string().nullable(), // ISO string in cache
})

type CachedMediaFile = z.infer<typeof CachedMediaFileSchema>

/**
 * Convert a MediaFile to a cacheable format (Date -> ISO string).
 */
function toCachedMediaFile(mediaFile: MediaFile): CachedMediaFile {
	return {
		...mediaFile,
		publicationDate: mediaFile.publicationDate?.toISOString() ?? null,
	}
}

/**
 * Convert a cached MediaFile back to the regular format (ISO string -> Date).
 */
function fromCachedMediaFile(cached: CachedMediaFile): MediaFile {
	return {
		...cached,
		publicationDate: cached.publicationDate
			? new Date(cached.publicationDate)
			: null,
	}
}

/**
 * Check if a path segment is in the ignored directories list
 */
function isIgnoredPath(filepath: string): boolean {
	const segments = filepath.split(path.sep)
	return segments.some((segment) => IGNORED_DIRECTORIES.has(segment))
}

/**
 * Check if a MIME type is audio or video
 */
function isMediaMimeType(mime: string): boolean {
	return mime.startsWith('audio/') || mime.startsWith('video/')
}

/**
 * Check if a string looks like a year (4 digits, reasonable range)
 */
function isYearString(value: string): boolean {
	const yearMatch = value.match(/^(\d{4})$/)
	if (!yearMatch) return false
	const year = parseInt(yearMatch[1]!, 10)
	// Reasonable year range for media
	return year >= 1900 && year <= 2100
}

/**
 * Check if a number looks like a year (reasonable range)
 */
function isYearNumber(value: number): boolean {
	return Number.isInteger(value) && value >= 1900 && value <= 2100
}

/**
 * Try to parse a value as a full date (not just a year)
 * Returns null if it's just a year or invalid
 */
function parseAsFullDate(value: string | number): Date | null {
	const str = String(value)

	// Reject if it's just a 4-digit year
	if (isYearString(str)) return null

	const parsed = new Date(str)
	if (Number.isNaN(parsed.getTime())) return null

	// Additional validation: make sure we got a reasonable date
	const year = parsed.getFullYear()
	const maxYear = new Date().getFullYear() + 2
	if (year <= 0 || year > maxYear) return null

	return parsed
}

/**
 * Extract publication date from metadata
 * Handles edge cases where date/year fields may be swapped or contain unexpected formats
 */
function extractPublicationDate(common: mm.ICommonTagsResult): Date | null {
	// First, try to get a full date from the date field
	if (common.date) {
		const fullDate = parseAsFullDate(common.date)
		if (fullDate) return fullDate
	}

	// Check if year field actually contains a full date string (metadata quirk)
	if (common.year) {
		// year is typed as number, but sometimes it's actually a date string
		const yearAsString = String(common.year)
		if (!isYearString(yearAsString)) {
			const fullDate = parseAsFullDate(yearAsString)
			if (fullDate) return fullDate
		}
	}

	// Fall back to year-only dates
	// Check if date field contains just a year
	if (common.date && isYearString(common.date)) {
		const year = parseInt(common.date, 10)
		return new Date(year, 0, 1)
	}

	// Use year field as a year
	if (common.year && isYearNumber(common.year)) {
		return new Date(common.year, 0, 1)
	}

	return null
}

/**
 * Safely convert a value to string, handling objects
 */
function valueToString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'object') {
		// Handle objects with text property (common in metadata)
		if ('text' in value && typeof (value as { text: unknown }).text === 'string') {
			return (value as { text: string }).text
		}
		// Try to extract meaningful content
		return JSON.stringify(value)
	}
	return String(value)
}

/**
 * Extract description from metadata
 */
function extractDescription(common: mm.ICommonTagsResult): string | null {
	if (common.description && common.description.length > 0) {
		return common.description.map(valueToString).filter(Boolean).join('\n')
	}
	if (common.comment && common.comment.length > 0) {
		return common.comment.map(valueToString).filter(Boolean).join('\n')
	}
	return null
}

/**
 * Lightweight check if a file is a media file using file-type detection
 */
export async function isMediaFile(filepath: string): Promise<boolean> {
	try {
		const fileType = await fileTypeFromFile(filepath)
		if (!fileType) return false
		return isMediaMimeType(fileType.mime)
	} catch {
		return false
	}
}

/**
 * Scan a directory tree and return paths to all media files
 */
export async function scanDirectory(directory: string): Promise<string[]> {
	const absoluteDir = path.resolve(directory)

	// Check directory exists
	try {
		const stat = await fs.promises.stat(absoluteDir)
		invariant(stat.isDirectory(), `Path is not a directory: ${absoluteDir}`)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			console.warn(`Directory does not exist: ${absoluteDir}`)
			return []
		}
		throw error
	}

	const mediaFiles: string[] = []

	// Read all entries recursively
	const entries = await fs.promises.readdir(absoluteDir, {
		recursive: true,
		withFileTypes: true,
	})

	for (const entry of entries) {
		// Skip directories
		if (entry.isDirectory()) continue

		// Build full path - parentPath is available when using recursive option
		const parentDir = entry.parentPath
		if (!parentDir) continue
		const fullPath = path.join(parentDir, entry.name)

		// Skip ignored paths
		if (isIgnoredPath(fullPath)) continue

		// Check if it's a media file
		if (await isMediaFile(fullPath)) {
			mediaFiles.push(fullPath)
		}
	}

	return mediaFiles
}

/**
 * Parse metadata directly from a file (no caching).
 * This is the expensive operation that we want to cache.
 */
async function parseFileMetadata(filepath: string): Promise<MediaFile | null> {
	try {
		const absolutePath = path.resolve(filepath)

		// Get file stats
		const stat = await fs.promises.stat(absolutePath)
		if (!stat.isFile()) return null

		// Get MIME type using file-type
		const fileType = await fileTypeFromFile(absolutePath)
		if (!fileType || !isMediaMimeType(fileType.mime)) return null

		// Parse metadata
		const metadata = await mm.parseFile(absolutePath, {
			skipCovers: true,
		})

		const filename = path.basename(absolutePath)
		const directory = path.dirname(absolutePath)

		const mediaFile: MediaFile = {
			path: absolutePath,
			filename,
			directory,
			title: metadata.common.title ?? filename,
			author: metadata.common.artist ?? null,
			duration: metadata.format.duration ?? null,
			publicationDate: extractPublicationDate(metadata.common),
			trackNumber: metadata.common.track?.no ?? null,
			description: extractDescription(metadata.common),
			sizeBytes: stat.size,
			mimeType: fileType.mime,
			fileModifiedAt: Math.floor(stat.mtimeMs / 1000),
		}

		// Validate with zod
		return MediaFileSchema.parse(mediaFile)
	} catch (error) {
		console.error(`Error reading metadata for ${filepath}:`, error)
		return null
	}
}

/**
 * Get cached file metadata, refreshing if the file has been modified.
 */
async function getCachedFileMetadata(
	filepath: string,
	fileMtime: number,
): Promise<MediaFile | null> {
	const cacheKey = `media:${filepath}`

	const cached = await cachified<CachedMediaFile | null>({
		key: cacheKey,
		ttl: 1000 * 60 * 60 * 24 * 7, // 7 days
		forceFresh: shouldRefreshCache(cacheKey, fileMtime),
		getFreshValue: async () => {
			const metadata = await parseFileMetadata(filepath)
			if (!metadata) return null
			// Convert to cacheable format (Date -> ISO string)
			return toCachedMediaFile(metadata)
		},
		checkValue: (value) => {
			// null is valid (means not a media file)
			if (value === null) return true
			// Validate cached value structure
			const result = CachedMediaFileSchema.safeParse(value)
			return result.success
		},
	})

	if (!cached) return null

	// Convert back from cached format (ISO string -> Date)
	return fromCachedMediaFile(cached)
}

/**
 * Get full metadata for a media file (with caching).
 * This is the public API for getting metadata for a single file.
 */
export async function getFileMetadata(
	filepath: string,
): Promise<MediaFile | null> {
	try {
		const absolutePath = path.resolve(filepath)
		const stat = await fs.promises.stat(absolutePath)
		return getCachedFileMetadata(absolutePath, stat.mtimeMs)
	} catch (error) {
		console.error(`Error getting metadata for ${filepath}:`, error)
		return null
	}
}

/**
 * Scan a directory and return metadata for all media files.
 * Uses caching and parallel processing for improved performance.
 */
export async function scanDirectoryWithMetadata(
	directory: string,
): Promise<MediaFile[]> {
	const filePaths = await scanDirectory(directory)

	// Get mtimes for all files (Bun.file().lastModified is sync and fast ~1.3µs/call)
	const validFileStats: Array<{ path: string; mtime: number }> = []
	for (const p of filePaths) {
		try {
			const mtime = Bun.file(p).lastModified
			validFileStats.push({ path: p, mtime })
		} catch {
			// File may have been deleted since scan
		}
	}

	// Extract metadata in parallel with concurrency limit
	const results = await Promise.all(
		validFileStats.map(({ path: filePath, mtime }) =>
			metadataLimit(() => getCachedFileMetadata(filePath, mtime)),
		),
	)

	return results.filter((r): r is MediaFile => r !== null)
}

/**
 * Scan all configured media roots and return metadata for all media files
 */
export async function scanAllMediaRoots(): Promise<MediaFile[]> {
	const roots = getMediaRoots()
	const allFiles: MediaFile[] = []

	for (const root of roots) {
		const files = await scanDirectoryWithMetadata(root.path)
		allFiles.push(...files)
	}

	return allFiles
}

/**
 * Pre-warm the media cache by scanning all configured media roots.
 * Called on server startup to populate cache before first request.
 */
export async function warmMediaCache(): Promise<void> {
	const roots = getMediaRoots()
	if (roots.length === 0) return

	console.log(`🔥 Warming media cache for ${roots.length} media root(s)...`)
	const startTime = Date.now()

	let totalFiles = 0
	for (const root of roots) {
		const files = await scanDirectoryWithMetadata(root.path)
		totalFiles += files.length
		console.log(`  ✓ ${root.name}: ${files.length} files cached`)
	}

	const duration = ((Date.now() - startTime) / 1000).toFixed(1)
	console.log(`🔥 Cache warming complete: ${totalFiles} files in ${duration}s`)
}
