import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { fileTypeFromFile } from 'file-type'
import { getMediaRootByName, getMediaRoots } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

/**
 * Allowed MIME types for media upload
 */
const ALLOWED_MIME_TYPES = new Set([
	// Audio
	'audio/mpeg',
	'audio/mp4',
	'audio/x-m4a',
	'audio/ogg',
	'audio/flac',
	'audio/wav',
	'audio/x-wav',
	'audio/webm',
	'audio/aac',
	'audio/x-aac',
	// Video
	'video/mp4',
	'video/x-matroska',
	'video/webm',
	'video/quicktime',
	'video/x-msvideo',
	'video/x-flv',
	'video/ogg',
])

/**
 * Check if a MIME type is allowed for upload
 */
function isAllowedMimeType(mime: string): boolean {
	return ALLOWED_MIME_TYPES.has(mime)
}

/**
 * Sanitize a filename to prevent path traversal and other issues.
 * @param filename - The original filename
 * @param defaultExt - Optional default extension to use if filename sanitizes to empty
 */
function sanitizeFilename(filename: string, defaultExt?: string): string {
	// Remove path separators and null bytes
	let sanitized = filename.replace(/[/\\:\0]/g, '_')

	// Remove leading dots to prevent hidden files
	sanitized = sanitized.replace(/^\.+/, '')

	// Limit length
	if (sanitized.length > 255) {
		const ext = nodePath.extname(sanitized)
		const base = nodePath.basename(sanitized, ext)
		sanitized = base.slice(0, 255 - ext.length) + ext
	}

	// If empty after sanitization, generate a name with proper extension
	if (!sanitized) {
		const ext = defaultExt ? `.${defaultExt}` : ''
		sanitized = `upload-${Date.now()}${ext}`
	}

	return sanitized
}

/**
 * Sanitize a subdirectory path to prevent traversal
 */
function sanitizeSubdirectory(subdir: string): string {
	// Remove leading/trailing slashes and normalize
	let sanitized = subdir.replace(/^[/\\]+|[/\\]+$/g, '')

	// Remove path traversal attempts
	sanitized = sanitized
		.split(/[/\\]+/)
		.filter((part) => part !== '..' && part !== '.' && part.length > 0)
		.join(nodePath.sep)

	return sanitized
}

/**
 * Atomically link a temp file to a target path, failing if target exists.
 * Uses fs.link + fs.unlink for atomic creation without overwrite.
 * Returns true if successful, false if target already exists.
 */
async function linkFileExclusive(
	tempPath: string,
	targetPath: string,
): Promise<boolean> {
	try {
		// Create a hard link - this is atomic and fails if target exists
		await fs.promises.link(tempPath, targetPath)
		return true
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
			return false
		}
		throw err
	}
}

/**
 * Move temp file to final location with unique filename.
 * Uses atomic operations to avoid race conditions.
 */
async function moveWithUniqueFilename(
	tempPath: string,
	targetDir: string,
	baseFilename: string,
): Promise<string> {
	const ext = nodePath.extname(baseFilename)
	const base = nodePath.basename(baseFilename, ext)

	// Try the original filename first
	let filename = baseFilename
	let targetPath = nodePath.join(targetDir, filename)

	if (await linkFileExclusive(tempPath, targetPath)) {
		// Successfully linked, remove temp file
		await fs.promises.unlink(tempPath)
		return filename
	}

	// Generate unique filenames with counter
	let counter = 1
	const maxAttempts = 1000 // Prevent infinite loop

	while (counter < maxAttempts) {
		filename = `${base}-${counter}${ext}`
		targetPath = nodePath.join(targetDir, filename)

		if (await linkFileExclusive(tempPath, targetPath)) {
			// Successfully linked, remove temp file
			await fs.promises.unlink(tempPath)
			return filename
		}

		counter++
	}

	// Clean up temp file before throwing
	try {
		await fs.promises.unlink(tempPath)
	} catch {
		// Ignore cleanup error
	}

	throw new Error('Could not generate unique filename after 1000 attempts')
}

/**
 * POST /admin/api/media/upload
 * Uploads a media file to a specified media root and optional subdirectory.
 *
 * Request body: multipart/form-data with:
 * - file: The media file to upload
 * - root: The name of the media root to upload to
 * - subdirectory: (optional) Subdirectory within the media root
 */
export default {
	middleware: [],
	async action(context) {
		if (context.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		// Parse multipart form data
		let formData: FormData
		try {
			formData = await context.request.formData()
		} catch {
			return Response.json(
				{ error: 'Invalid multipart form data' },
				{ status: 400 },
			)
		}

		// Get the file
		const file = formData.get('file')
		if (!file || !(file instanceof File)) {
			return Response.json({ error: 'No file provided' }, { status: 400 })
		}

		// Check file size (limit to 10GB)
		const maxSize = 10 * 1024 * 1024 * 1024 // 10GB
		if (file.size > maxSize) {
			return Response.json(
				{ error: 'File too large. Maximum size is 10GB.' },
				{ status: 400 },
			)
		}

		// Get the target media root
		const rootName = formData.get('root')
		if (!rootName || typeof rootName !== 'string') {
			return Response.json(
				{ error: 'Missing required "root" parameter' },
				{ status: 400 },
			)
		}

		const mediaRoot = getMediaRootByName(rootName)
		if (!mediaRoot) {
			const availableRoots = getMediaRoots()
				.map((r) => r.name)
				.join(', ')
			return Response.json(
				{
					error: `Unknown media root: ${rootName}. Available roots: ${availableRoots}`,
				},
				{ status: 400 },
			)
		}

		// Get optional subdirectory
		const subdirectory = formData.get('subdirectory')
		let targetDir = mediaRoot.path
		let relativePath = ''

		if (subdirectory && typeof subdirectory === 'string') {
			const sanitizedSubdir = sanitizeSubdirectory(subdirectory)
			if (sanitizedSubdir) {
				targetDir = nodePath.join(mediaRoot.path, sanitizedSubdir)
				relativePath = sanitizedSubdir
			}
		}

		// Ensure target directory exists
		try {
			await fs.promises.mkdir(targetDir, { recursive: true })
		} catch (err) {
			console.error('Failed to create directory:', err)
			return Response.json(
				{ error: 'Failed to create target directory' },
				{ status: 500 },
			)
		}

		// Create a temporary file path for initial upload
		// Use a hidden file prefix so it doesn't show up in directory listings
		const tempFilename = `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
		const tempPath = nodePath.join(targetDir, tempFilename)

		// Stream the file to disk first (avoids loading entire file into memory)
		try {
			await Bun.write(tempPath, file)
		} catch (err) {
			console.error('Failed to write temp file:', err)
			return Response.json({ error: 'Failed to save file' }, { status: 500 })
		}

		// Detect MIME type from the file on disk (only reads first few KB)
		let detectedType: { ext: string; mime: string } | undefined
		try {
			detectedType = await fileTypeFromFile(tempPath)
		} catch (err) {
			// Clean up temp file on error
			try {
				await fs.promises.unlink(tempPath)
			} catch {
				// Ignore cleanup errors
			}
			console.error('Failed to detect file type:', err)
			return Response.json(
				{ error: 'Failed to detect file type' },
				{ status: 500 },
			)
		}

		if (!detectedType) {
			// Clean up temp file
			try {
				await fs.promises.unlink(tempPath)
			} catch {
				// Ignore cleanup errors
			}
			return Response.json(
				{
					error:
						'Could not determine file type. Please upload a valid media file.',
				},
				{ status: 400 },
			)
		}

		if (!isAllowedMimeType(detectedType.mime)) {
			// Clean up temp file
			try {
				await fs.promises.unlink(tempPath)
			} catch {
				// Ignore cleanup errors
			}
			return Response.json(
				{
					error: `File type not allowed: ${detectedType.mime}. Allowed types are audio and video files.`,
				},
				{ status: 400 },
			)
		}

		// Sanitize the filename, passing the detected extension for fallback
		const originalFilename =
			file.name || `upload-${Date.now()}.${detectedType.ext}`
		const sanitizedFilename = sanitizeFilename(
			originalFilename,
			detectedType.ext,
		)

		// Ensure the filename has the correct extension based on detected type
		let targetFilename = sanitizedFilename
		const currentExt = nodePath
			.extname(sanitizedFilename)
			.toLowerCase()
			.slice(1)
		if (!currentExt || currentExt !== detectedType.ext) {
			// If no extension or wrong extension, append the correct one
			const base = nodePath.basename(
				sanitizedFilename,
				nodePath.extname(sanitizedFilename),
			)
			targetFilename = `${base}.${detectedType.ext}`
		}

		// Move temp file to final location with unique filename (atomic, no race conditions)
		let finalFilename: string
		try {
			finalFilename = await moveWithUniqueFilename(
				tempPath,
				targetDir,
				targetFilename,
			)
		} catch (err) {
			// Clean up temp file if it still exists
			try {
				await fs.promises.unlink(tempPath)
			} catch {
				// Ignore cleanup errors
			}
			console.error('Failed to move file:', err)
			return Response.json({ error: 'Failed to save file' }, { status: 500 })
		}

		const finalRelativePath = relativePath
			? nodePath.join(relativePath, finalFilename)
			: finalFilename

		return Response.json(
			{
				success: true,
				file: {
					filename: finalFilename,
					size: file.size,
					mimeType: detectedType.mime,
					rootName: rootName,
					relativePath: finalRelativePath,
					mediaPath: `${rootName}:${finalRelativePath}`,
				},
			},
			{ status: 201 },
		)
	},
} satisfies Action<
	typeof routes.adminApiMediaUpload.method,
	typeof routes.adminApiMediaUpload.pattern.source
>
