import path from 'node:path'
import { fileTypeFromBlob, fileTypeFromFile } from 'file-type'

const ARTWORK_DIR = path.join(process.cwd(), 'data', 'artwork')
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Ensure the artwork directory exists.
 */
async function ensureArtworkDir(): Promise<void> {
	const { mkdir } = await import('node:fs/promises')
	await mkdir(ARTWORK_DIR, { recursive: true })
}

/**
 * Find the path to uploaded artwork for a feed.
 * Returns the full path and detected MIME type if found, null otherwise.
 */
export async function getFeedArtworkPath(
	feedId: string,
): Promise<{ path: string; mimeType: string } | null> {
	for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
		const artPath = path.join(ARTWORK_DIR, `${feedId}.${ext}`)
		const file = Bun.file(artPath)
		if (await file.exists()) {
			// Detect actual MIME type from file content
			const fileType = await fileTypeFromFile(artPath)
			const mimeType = fileType?.mime ?? 'application/octet-stream'
			return { path: artPath, mimeType }
		}
	}
	return null
}

/**
 * Delete uploaded artwork for a feed.
 * Returns true if artwork was deleted, false if no artwork existed.
 */
export async function deleteFeedArtwork(feedId: string): Promise<boolean> {
	const artwork = await getFeedArtworkPath(feedId)
	if (!artwork) {
		return false
	}

	try {
		const { unlink } = await import('node:fs/promises')
		await unlink(artwork.path)
		return true
	} catch (error) {
		console.error(`Error deleting artwork for feed ${feedId}:`, error)
		return false
	}
}

/**
 * Save uploaded artwork for a feed.
 * Deletes any existing artwork first.
 * Returns the saved file path, or null if save failed.
 */
export async function saveFeedArtwork(
	feedId: string,
	file: File,
): Promise<{ path: string; error?: never } | { path?: never; error: string }> {
	// Validate file size
	if (file.size > MAX_FILE_SIZE) {
		return { error: `File too large. Maximum size is 5MB.` }
	}

	// Detect actual file type from content (more secure than trusting file.type)
	const fileType = await fileTypeFromBlob(file)
	if (!fileType || !ALLOWED_MIME_TYPES.has(fileType.mime)) {
		return {
			error: `Invalid file type: ${fileType?.mime ?? 'unknown'}. Allowed types: JPEG, PNG, WebP.`,
		}
	}

	// Ensure directory exists
	await ensureArtworkDir()

	// Delete any existing artwork
	await deleteFeedArtwork(feedId)

	// Save new artwork using detected extension
	const artworkPath = path.join(ARTWORK_DIR, `${feedId}.${fileType.ext}`)

	try {
		const arrayBuffer = await file.arrayBuffer()
		await Bun.write(artworkPath, arrayBuffer)
		return { path: artworkPath }
	} catch (error) {
		console.error(`Error saving artwork for feed ${feedId}:`, error)
		return { error: 'Failed to save artwork file.' }
	}
}

/**
 * Check if a feed has uploaded artwork.
 */
export async function hasFeedArtwork(feedId: string): Promise<boolean> {
	const artwork = await getFeedArtworkPath(feedId)
	return artwork !== null
}
