import path from 'node:path'
import * as mm from 'music-metadata'

/**
 * Artwork extracted from a media file.
 */
export type Artwork = {
	data: Buffer
	mimeType: string
}

/**
 * Extract embedded cover artwork from a media file.
 *
 * Most audio files (MP3, M4A, M4B, FLAC, etc.) can contain embedded
 * cover art. This function extracts the first available picture.
 *
 * @param filepath - Path to the media file
 * @returns Artwork object with data buffer and MIME type, or null if no artwork found
 */
export async function extractArtwork(
	filepath: string,
): Promise<Artwork | null> {
	try {
		const absolutePath = path.resolve(filepath)
		const metadata = await mm.parseFile(absolutePath, {
			skipCovers: false,
		})

		const pictures = metadata.common.picture
		if (!pictures || pictures.length === 0) {
			return null
		}

		// Get the first picture (usually the front cover)
		const picture = pictures[0]!

		return {
			data: Buffer.from(picture.data),
			mimeType: picture.format,
		}
	} catch (error) {
		console.error(`Error extracting artwork from ${filepath}:`, error)
		return null
	}
}

/**
 * Get the preferred artwork MIME type for a picture format.
 * Falls back to 'image/jpeg' if format is unknown.
 */
export function getArtworkMimeType(format: string): string {
	// music-metadata returns formats like 'image/jpeg', 'image/png'
	// But sometimes it's just 'jpeg' or 'png'
	if (format.startsWith('image/')) {
		return format
	}

	const mimeMap: Record<string, string> = {
		jpeg: 'image/jpeg',
		jpg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
	}

	return mimeMap[format.toLowerCase()] ?? 'image/jpeg'
}
