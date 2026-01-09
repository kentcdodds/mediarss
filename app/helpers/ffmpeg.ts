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
	date?: string // maps to "date" tag - supports "YYYY" or "YYYY-MM-DD" format
	genre?: string
	trackNumber?: number // maps to "track" tag
	copyright?: string
	// Additional fields
	narrator?: string // maps to TPE3 (MP3), custom iTunes NARRATOR (MP4), or performer (MKV)
	album?: string
	albumArtist?: string // maps to "album_artist" tag
	composer?: string
	publisher?: string
	discNumber?: number // maps to "disc" tag
	language?: string
	series?: string // maps to "show" or "series" tag
	seriesPosition?: string // maps to "episode_sort" or "series-part" tag
	encodedBy?: string // maps to "encoded_by" tag
	subtitle?: string // secondary title
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
		date: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
		narrator: 'TPE3', // ID3v2 conductor/performer - used for narrators
		album: 'album',
		albumArtist: 'album_artist',
		composer: 'composer',
		publisher: 'publisher',
		discNumber: 'disc',
		language: 'language',
		series: 'TXXX:series', // Custom tag for series name
		seriesPosition: 'TXXX:series-part', // Custom tag for series position
		encodedBy: 'encoded_by',
		subtitle: 'TIT3', // ID3v2 subtitle/description refinement
	},
	// M4A/M4B (iTunes/QuickTime)
	mp4: {
		title: 'title',
		author: 'artist',
		description: 'comment',
		date: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
		narrator: '----:com.apple.iTunes:NARRATOR', // Custom iTunes tag for narrator
		album: 'album',
		albumArtist: 'album_artist',
		composer: 'composer',
		publisher: 'publisher',
		discNumber: 'disc',
		language: 'language',
		series: 'show', // TV Show / Podcast name
		seriesPosition: 'episode_sort', // Episode number
		encodedBy: 'encoded_by',
		subtitle: 'subtitle', // Subtitle / description refinement
	},
	// MKV (Matroska)
	mkv: {
		title: 'title',
		author: 'artist',
		description: 'comment',
		date: 'date',
		genre: 'genre',
		trackNumber: 'track',
		copyright: 'copyright',
		narrator: 'performer', // Matroska uses performer
		album: 'album',
		albumArtist: 'album_artist',
		composer: 'composer',
		publisher: 'publisher',
		discNumber: 'disc',
		language: 'language',
		series: 'show',
		seriesPosition: 'episode_sort',
		encodedBy: 'encoded_by',
		subtitle: 'subtitle',
	},
} as const

/**
 * Get the format type from MIME type.
 */
function getFormatType(mimeType: string): 'mp3' | 'mp4' | 'mkv' | null {
	if (mimeType === 'audio/mpeg') return 'mp3'
	// M4A files can have audio/mp4, audio/x-m4a, or video/mp4 MIME types
	if (
		mimeType === 'audio/mp4' ||
		mimeType === 'audio/x-m4a' ||
		mimeType === 'video/mp4'
	)
		return 'mp4'
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
	if (metadata.date !== undefined) {
		args.push('-metadata', `${mapping.date}=${metadata.date}`)
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
	if (metadata.narrator !== undefined) {
		args.push('-metadata', `${mapping.narrator}=${metadata.narrator}`)
	}
	if (metadata.album !== undefined) {
		args.push('-metadata', `${mapping.album}=${metadata.album}`)
	}
	if (metadata.albumArtist !== undefined) {
		args.push('-metadata', `${mapping.albumArtist}=${metadata.albumArtist}`)
	}
	if (metadata.composer !== undefined) {
		args.push('-metadata', `${mapping.composer}=${metadata.composer}`)
	}
	if (metadata.publisher !== undefined) {
		args.push('-metadata', `${mapping.publisher}=${metadata.publisher}`)
	}
	if (metadata.discNumber !== undefined) {
		args.push('-metadata', `${mapping.discNumber}=${metadata.discNumber}`)
	}
	if (metadata.language !== undefined) {
		args.push('-metadata', `${mapping.language}=${metadata.language}`)
	}
	if (metadata.series !== undefined) {
		args.push('-metadata', `${mapping.series}=${metadata.series}`)
	}
	if (metadata.seriesPosition !== undefined) {
		args.push(
			'-metadata',
			`${mapping.seriesPosition}=${metadata.seriesPosition}`,
		)
	}
	if (metadata.encodedBy !== undefined) {
		args.push('-metadata', `${mapping.encodedBy}=${metadata.encodedBy}`)
	}
	if (metadata.subtitle !== undefined) {
		args.push('-metadata', `${mapping.subtitle}=${metadata.subtitle}`)
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
