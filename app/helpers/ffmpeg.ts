import fs from 'node:fs'
import path from 'node:path'
import { $ } from 'bun'

/**
 * Metadata fields that can be edited via FFmpeg.
 */
export type EditableMetadata = {
	title?: string
	author?: string // maps to "artist" tag
	description?: string // maps to "comment" tag
	year?: number // maps to "date" tag
	genre?: string
	trackNumber?: number // maps to "track" tag
	copyright?: string
}

/**
 * FFmpeg metadata tag mappings for different container formats.
 * Different formats use different tag names for the same concept.
 */
const TAG_MAPPINGS = {
	// MP3 (ID3v2)
	mp3: {
		title: 'title',
		author: 'artist',
		description: 'comment',
		year: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
	},
	// M4A/M4B (iTunes/QuickTime)
	mp4: {
		title: 'title',
		author: 'artist',
		description: 'comment',
		year: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
	},
	// MKV (Matroska)
	mkv: {
		title: 'title',
		author: 'artist', // or ARTIST
		description: 'comment', // or DESCRIPTION
		year: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
	},
} as const

/**
 * Get the format type from MIME type.
 */
function getFormatType(mimeType: string): 'mp3' | 'mp4' | 'mkv' | null {
	if (mimeType === 'audio/mpeg') return 'mp3'
	if (mimeType === 'audio/mp4' || mimeType === 'video/mp4') return 'mp4'
	if (mimeType === 'video/x-matroska' || mimeType === 'audio/x-matroska')
		return 'mkv'
	return null
}

/**
 * Build FFmpeg metadata arguments from the editable metadata.
 */
function buildMetadataArgs(
	metadata: EditableMetadata,
	formatType: 'mp3' | 'mp4' | 'mkv',
): string[] {
	const mapping = TAG_MAPPINGS[formatType]
	const args: string[] = []

	if (metadata.title !== undefined) {
		args.push('-metadata', `${mapping.title}=${metadata.title}`)
	}
	if (metadata.author !== undefined) {
		args.push('-metadata', `${mapping.author}=${metadata.author}`)
	}
	if (metadata.description !== undefined) {
		args.push('-metadata', `${mapping.description}=${metadata.description}`)
	}
	if (metadata.year !== undefined) {
		args.push('-metadata', `${mapping.year}=${metadata.year}`)
	}
	if (metadata.genre !== undefined) {
		args.push('-metadata', `${mapping.genre}=${metadata.genre}`)
	}
	if (metadata.trackNumber !== undefined) {
		args.push('-metadata', `${mapping.trackNumber}=${metadata.trackNumber}`)
	}
	if (metadata.copyright !== undefined) {
		args.push('-metadata', `${mapping.copyright}=${metadata.copyright}`)
	}

	return args
}

/**
 * Update metadata for a media file using FFmpeg.
 *
 * This function:
 * 1. Creates a temporary file
 * 2. Runs FFmpeg to copy the media with updated metadata
 * 3. Atomically replaces the original file with the updated one
 * 4. Preserves file permissions
 *
 * @param filePath - Absolute path to the media file
 * @param mimeType - MIME type of the file (used to determine format)
 * @param metadata - Metadata fields to update
 * @throws Error if FFmpeg fails or the format is unsupported
 */
export async function updateMetadata(
	filePath: string,
	mimeType: string,
	metadata: EditableMetadata,
): Promise<void> {
	const formatType = getFormatType(mimeType)
	if (!formatType) {
		throw new Error(`Unsupported format for metadata editing: ${mimeType}`)
	}

	// Build metadata arguments
	const metadataArgs = buildMetadataArgs(metadata, formatType)
	if (metadataArgs.length === 0) {
		return // Nothing to update
	}

	// Get original file permissions
	const originalStats = await fs.promises.stat(filePath)

	// Create temp file in the same directory to ensure atomic rename works
	const dir = path.dirname(filePath)
	const ext = path.extname(filePath)
	const tempFile = path.join(
		dir,
		`.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
	)

	try {
		// Build FFmpeg command
		// -i: input file
		// -c copy: copy all streams without re-encoding
		// -map_metadata 0: copy existing metadata from input
		// -metadata key=value: set/override specific metadata
		// -y: overwrite output file without asking
		const ffmpegArgs = [
			'-i',
			filePath,
			'-c',
			'copy',
			'-map_metadata',
			'0',
			...metadataArgs,
			'-y',
			tempFile,
		]

		// Run FFmpeg
		const result = await $`ffmpeg ${ffmpegArgs}`.quiet()

		if (result.exitCode !== 0) {
			throw new Error(
				`FFmpeg failed with exit code ${result.exitCode}: ${result.stderr.toString()}`,
			)
		}

		// Verify temp file was created and has content
		const tempStats = await fs.promises.stat(tempFile)
		if (tempStats.size === 0) {
			throw new Error('FFmpeg produced an empty file')
		}

		// Atomically replace original with temp file
		await fs.promises.rename(tempFile, filePath)

		// Restore original permissions
		await fs.promises.chmod(filePath, originalStats.mode)
	} catch (error) {
		// Clean up temp file on error
		try {
			await fs.promises.unlink(tempFile)
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}

/**
 * Check if FFmpeg is available on the system.
 */
export async function isFFmpegAvailable(): Promise<boolean> {
	try {
		const result = await $`ffmpeg -version`.quiet()
		return result.exitCode === 0
	} catch {
		return false
	}
}
