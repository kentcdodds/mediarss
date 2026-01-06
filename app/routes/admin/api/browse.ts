import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { fileTypeFromFile } from 'file-type'
import { getMediaRootByName } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

type DirectoryEntry = {
	name: string
	type: 'directory' | 'file'
}

type BrowseStats = {
	filesInDirectory: number
	filesInSubdirectories: number
	totalFiles: number
}

/**
 * Directories to skip when counting files
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
 * Check if a path should be ignored
 */
function isIgnoredPath(filepath: string): boolean {
	const segments = filepath.split(nodePath.sep)
	return segments.some((segment) => IGNORED_DIRECTORIES.has(segment))
}

/**
 * Quick check if a file might be a media file by extension
 * This is used as a pre-filter before the more expensive file-type check
 */
const MEDIA_EXTENSIONS = new Set([
	'.mp3',
	'.m4a',
	'.m4b',
	'.aac',
	'.ogg',
	'.flac',
	'.wav',
	'.wma',
	'.opus',
	'.mp4',
	'.m4v',
	'.mkv',
	'.avi',
	'.mov',
	'.wmv',
	'.webm',
	'.flv',
])

function hasMediaExtension(filename: string): boolean {
	const ext = nodePath.extname(filename).toLowerCase()
	return MEDIA_EXTENSIONS.has(ext)
}

/**
 * Check if a file is actually a media file using file-type detection
 */
async function isMediaFile(filepath: string): Promise<boolean> {
	try {
		const fileType = await fileTypeFromFile(filepath)
		if (!fileType) return false
		return (
			fileType.mime.startsWith('audio/') || fileType.mime.startsWith('video/')
		)
	} catch {
		return false
	}
}

/**
 * Count media files in a directory (non-recursive)
 */
async function countFilesInDirectory(dirPath: string): Promise<number> {
	let count = 0
	const entries = fs.readdirSync(dirPath, { withFileTypes: true })

	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue
		if (!entry.isFile()) continue
		if (!hasMediaExtension(entry.name)) continue

		const fullPath = nodePath.join(dirPath, entry.name)
		if (await isMediaFile(fullPath)) {
			count++
		}
	}

	return count
}

/**
 * Count media files recursively in subdirectories (with limit)
 */
async function countFilesInSubdirectories(
	dirPath: string,
	maxFiles = 10000,
): Promise<number> {
	let count = 0

	try {
		const entries = fs.readdirSync(dirPath, {
			recursive: true,
			withFileTypes: true,
		})

		for (const entry of entries) {
			if (count >= maxFiles) break
			if (entry.name.startsWith('.')) continue
			if (!entry.isFile()) continue
			if (!hasMediaExtension(entry.name)) continue

			const parentDir = entry.parentPath
			if (!parentDir) continue

			// Only count files in subdirectories, not the current directory
			if (parentDir === dirPath) continue

			const fullPath = nodePath.join(parentDir, entry.name)
			if (isIgnoredPath(fullPath)) continue

			if (await isMediaFile(fullPath)) {
				count++
			}
		}
	} catch {
		// If recursive read fails, return 0
	}

	return count
}

/**
 * GET /admin/api/browse?root=<name>&path=<relative-path>
 * Returns list of entries (directories and files) at the specified path
 * within the given media root.
 */
export default {
	middleware: [],
	async action(context) {
		const url = context.url
		const rootName = url.searchParams.get('root')
		const relativePath = url.searchParams.get('path') ?? ''

		if (!rootName) {
			return Response.json(
				{ error: 'Missing required "root" parameter' },
				{ status: 400 },
			)
		}

		const mediaRoot = getMediaRootByName(rootName)
		if (!mediaRoot) {
			return Response.json(
				{ error: `Media root "${rootName}" not found` },
				{ status: 404 },
			)
		}

		// Resolve the target path and validate it's within the media root
		const rootResolved = nodePath.resolve(mediaRoot.path)
		const targetPath = nodePath.resolve(mediaRoot.path, relativePath)

		// Security: ensure the target path is within the media root
		if (
			!targetPath.startsWith(rootResolved + nodePath.sep) &&
			targetPath !== rootResolved
		) {
			return Response.json(
				{ error: 'Path traversal not allowed' },
				{ status: 403 },
			)
		}

		// Check if directory exists
		if (!fs.existsSync(targetPath)) {
			return Response.json({ error: 'Directory not found' }, { status: 404 })
		}

		const stat = fs.statSync(targetPath)
		if (!stat.isDirectory()) {
			return Response.json(
				{ error: 'Path is not a directory' },
				{ status: 400 },
			)
		}

		// Read directory entries
		const entries: Array<DirectoryEntry> = []
		const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true })

		for (const entry of dirEntries) {
			// Skip hidden files/directories
			if (entry.name.startsWith('.')) continue

			entries.push({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file',
			})
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1
			}
			return a.name.localeCompare(b.name)
		})

		// Count media files for stats
		const filesInDirectory = await countFilesInDirectory(targetPath)
		const filesInSubdirectories = await countFilesInSubdirectories(targetPath)
		const stats: BrowseStats = {
			filesInDirectory,
			filesInSubdirectories,
			totalFiles: filesInDirectory + filesInSubdirectories,
		}

		return Response.json({
			root: rootName,
			path: relativePath,
			entries,
			stats,
		})
	},
} satisfies Action<
	typeof routes.adminApiBrowse.method,
	typeof routes.adminApiBrowse.pattern.source
>
