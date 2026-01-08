import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { fileTypeFromBuffer } from 'file-type'
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
 * Sanitize a filename to prevent path traversal and other issues
 */
function sanitizeFilename(filename: string): string {
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

	// If empty after sanitization, generate a name
	if (!sanitized) {
		sanitized = `upload-${Date.now()}`
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

		// Validate the file content type
		const fileBuffer = await file.arrayBuffer()
		const fileBytes = new Uint8Array(fileBuffer)

		// Use file-type to detect the actual MIME type
		const detectedType = await fileTypeFromBuffer(fileBytes)
		if (!detectedType) {
			return Response.json(
				{
					error:
						'Could not determine file type. Please upload a valid media file.',
				},
				{ status: 400 },
			)
		}

		if (!isAllowedMimeType(detectedType.mime)) {
			return Response.json(
				{
					error: `File type not allowed: ${detectedType.mime}. Allowed types are audio and video files.`,
				},
				{ status: 400 },
			)
		}

		// Sanitize the filename
		const originalFilename =
			file.name || `upload-${Date.now()}.${detectedType.ext}`
		const sanitizedFilename = sanitizeFilename(originalFilename)

		// Build the full file path
		const filePath = nodePath.join(targetDir, sanitizedFilename)

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

		// Check if file already exists
		if (fs.existsSync(filePath)) {
			// Generate a unique filename
			const ext = nodePath.extname(sanitizedFilename)
			const base = nodePath.basename(sanitizedFilename, ext)
			let counter = 1
			let uniqueFilename = sanitizedFilename
			let uniquePath = filePath

			while (fs.existsSync(uniquePath)) {
				uniqueFilename = `${base}-${counter}${ext}`
				uniquePath = nodePath.join(targetDir, uniqueFilename)
				counter++
			}

			// Use the unique path
			const finalPath = uniquePath
			const finalFilename = uniqueFilename

			// Write the file
			try {
				await Bun.write(finalPath, fileBytes)
			} catch (err) {
				console.error('Failed to write file:', err)
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
		}

		// Write the file
		try {
			await Bun.write(filePath, fileBytes)
		} catch (err) {
			console.error('Failed to write file:', err)
			return Response.json({ error: 'Failed to save file' }, { status: 500 })
		}

		const finalRelativePath = relativePath
			? nodePath.join(relativePath, sanitizedFilename)
			: sanitizedFilename

		return Response.json(
			{
				success: true,
				file: {
					filename: sanitizedFilename,
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
