import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { initEnv } from '#app/config/env.ts'
import { consoleError, consoleWarn } from '#test/setup.ts'
import {
	extractDescription,
	extractPublicationDate,
	getFileMetadata,
	isMediaFile,
	scanDirectory,
	scanDirectoryWithMetadata,
} from './media.ts'

// Initialize environment for tests
initEnv()

const TEST_AUDIO_DIR = './test/fixtures/audio'
const TEST_VIDEO_DIR = './test/fixtures/video'

/**
 * Creates a temporary empty directory that will be automatically cleaned up.
 */
function createTempDirectory() {
	const tempDir = `./test/fixtures/empty-test-dir-${Date.now()}`
	return {
		path: tempDir,
		async setup() {
			await fs.mkdir(tempDir, { recursive: true })
			await fs.writeFile(`${tempDir}/.gitkeep`, '')
		},
		[Symbol.asyncDispose]: async () => {
			// SWR background revalidation may warn after cleanup deletes the directory
			consoleWarn.mockImplementation(() => {})
			await fs.rm(tempDir, { force: true, recursive: true })
			// Wait for SWR background revalidation to complete
			await new Promise((resolve) => setTimeout(resolve, 10))
		},
	}
}

test('isMediaFile correctly identifies media and non-media files', async () => {
	// Audio files should be identified as media
	await expect(
		isMediaFile(path.join(TEST_AUDIO_DIR, 'Inkheart.m4b')),
	).resolves.toBe(true)
	await expect(
		isMediaFile(
			path.join(TEST_AUDIO_DIR, 'On the Edge of the Dark Sea of Darkness.mp3'),
		),
	).resolves.toBe(true)

	// Video files should be identified as media
	await expect(
		isMediaFile(path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')),
	).resolves.toBe(true)

	// Non-existent files should return false
	await expect(isMediaFile('/nonexistent/file.mp3')).resolves.toBe(false)

	// Non-media files should return false
	await expect(isMediaFile('./package.json')).resolves.toBe(false)
})

test('scanDirectory finds media files in directories', async () => {
	// Audio directory should contain audio files with absolute paths
	const audioFiles = await scanDirectory(TEST_AUDIO_DIR)
	expect(audioFiles.length).toBeGreaterThan(0)
	for (const file of audioFiles) {
		expect(path.isAbsolute(file)).toBe(true)
	}

	// Video directory should contain video files
	const videoFiles = await scanDirectory(TEST_VIDEO_DIR)
	expect(videoFiles.length).toBeGreaterThan(0)
	expect(videoFiles.some((f) => f.includes('Toy Story'))).toBe(true)

	// Non-existent directory should return empty array
	consoleWarn.mockImplementation(() => {})
	const nonExistentFiles = await scanDirectory('/nonexistent/directory')
	expect(nonExistentFiles).toEqual([])
	// Wait for SWR background revalidation to complete
	await new Promise((resolve) => setTimeout(resolve, 10))
})

test('scanDirectory returns empty array for directory without media files', async () => {
	await using tempDir = createTempDirectory()
	await tempDir.setup()

	const files = await scanDirectory(tempDir.path)
	// .gitkeep is not a media file, so should be empty
	expect(files).toEqual([])
})

test('getFileMetadata extracts metadata from various media file types', async () => {
	// Test m4b audiobook
	const m4bMetadata = await getFileMetadata(
		path.join(TEST_AUDIO_DIR, 'Inkheart.m4b'),
	)
	expect(m4bMetadata).not.toBeNull()
	expect(m4bMetadata!.path).toContain('Inkheart')
	expect(m4bMetadata!.filename).toBe('Inkheart.m4b')
	expect(m4bMetadata!.mimeType).toMatch(/audio/)
	expect(m4bMetadata!.sizeBytes).toBeGreaterThan(0)
	expect(m4bMetadata!.fileModifiedAt).toBeGreaterThan(0)
	expect(m4bMetadata!.title.length).toBeGreaterThan(0)

	// Test mp3 file
	const mp3Metadata = await getFileMetadata(
		path.join(TEST_AUDIO_DIR, 'On the Edge of the Dark Sea of Darkness.mp3'),
	)
	expect(mp3Metadata).not.toBeNull()
	expect(mp3Metadata!.mimeType).toBe('audio/mpeg')
	expect(mp3Metadata!.sizeBytes).toBeGreaterThan(0)

	// Test mkv video
	const mkvMetadata = await getFileMetadata(
		path.join(TEST_VIDEO_DIR, 'Toy Story.mkv'),
	)
	expect(mkvMetadata).not.toBeNull()
	expect(mkvMetadata!.mimeType).toMatch(/video/)
	expect(mkvMetadata!.filename).toBe('Toy Story.mkv')
})

test('getFileMetadata returns null for non-existent and non-media files', async () => {
	// Non-existent file
	const nonExistentMetadata = await getFileMetadata('/nonexistent/file.mp3')
	expect(nonExistentMetadata).toBeNull()
	expect(consoleError).not.toHaveBeenCalled()

	// Reset mock for non-media file test
	consoleError.mockClear()

	// Non-media file
	const nonMediaMetadata = await getFileMetadata('./package.json')
	expect(nonMediaMetadata).toBeNull()
})

test('scanDirectoryWithMetadata returns complete metadata for all media files', async () => {
	// Directory with media files should return metadata for each
	const audioFilesWithMetadata = await scanDirectoryWithMetadata(TEST_AUDIO_DIR)
	expect(audioFilesWithMetadata.length).toBeGreaterThan(0)
	for (const file of audioFilesWithMetadata) {
		expect(file.path).toBeTruthy()
		expect(file.filename).toBeTruthy()
		expect(file.mimeType).toBeTruthy()
		expect(file.sizeBytes).toBeGreaterThan(0)
	}

	// Directory without media files should return empty array
	const noMediaFiles = await scanDirectoryWithMetadata('./app/db')
	expect(noMediaFiles).toEqual([])
})

function metadataWithCommon(
	common: Record<string, unknown>,
	native: Record<string, Array<{ id: string; value: unknown }>> = {},
): Parameters<typeof extractPublicationDate>[0] {
	return {
		common: {
			track: { no: null, of: null },
			disk: { no: null, of: null },
			movementIndex: { no: null, of: null },
			...common,
		},
		format: { trackInfo: [], tagTypes: [] },
		native,
		quality: { warnings: [] },
	}
}

test('extractPublicationDate prefers TDRL releasedate over year-only TDRC date', () => {
	// Podcast files often have TDRC=2026 (year) and TDRL=2026-07-28 (full date).
	// music-metadata maps those to common.date and common.releasedate.
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026',
			releasedate: '2026-07-28',
		}),
	)

	expect(publicationDate).not.toBeNull()
	expect(publicationDate!.toISOString().startsWith('2026-07-28')).toBe(true)
})

test('extractPublicationDate prefers releasedate over full common.date', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026-01-01',
			releasedate: '2026-07-28',
		}),
	)

	expect(publicationDate).not.toBeNull()
	expect(publicationDate!.toISOString().startsWith('2026-07-28')).toBe(true)
})

test('extractPublicationDate falls back to common.date when releasedate is missing', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2025-03-15',
		}),
	)

	expect(publicationDate).not.toBeNull()
	expect(publicationDate!.toISOString().startsWith('2025-03-15')).toBe(true)
})

test('extractDescription ignores Apple iTun* COMM frames', () => {
	// Podcasts from Apple include private COMM tags (iTunNORM, iTunPGAP, iTunSMPB)
	// alongside the real description. Those must not leak into RSS item text.
	const description = extractDescription(
		metadataWithCommon({
			comment: [
				{ language: 'eng', descriptor: 'iTunPGAP', text: '0' },
				{
					language: 'eng',
					descriptor: 'iTunNORM',
					text: ' 00000473 00000473 000072AE 000072AE 0027971A 0027971A 00007213 00007213 000004CB 000019B6',
				},
				{
					language: 'eng',
					descriptor: 'iTunSMPB',
					text: ' 00000000 00000210 0000098B 000000000CD49165 00000000 04A7A53D 00000000 00000000 00000000 00000000 00000000 00000000',
				},
				{
					language: 'eng',
					descriptor: '',
					text: 'This is the actual description.',
				},
			],
		}),
		null,
	)

	expect(description).toBe('This is the actual description.')
})

test('extractDescription keeps non-iTunes comments when mixed with iTun* frames', () => {
	const description = extractDescription(
		metadataWithCommon({
			comment: [
				{ language: 'eng', descriptor: 'iTunNORM', text: ' 00000473' },
				{ language: 'eng', descriptor: 'note', text: 'Producer notes' },
				{ language: 'eng', descriptor: '', text: 'Episode summary' },
			],
		}),
		null,
	)

	expect(description).toBe('Producer notes\nEpisode summary')
})

test('extractDescription returns null when only Apple iTun* COMM frames exist', () => {
	const description = extractDescription(
		metadataWithCommon(
			{
				comment: [
					{ language: 'eng', descriptor: 'iTunPGAP', text: '0' },
					{
						language: 'eng',
						descriptor: 'iTunNORM',
						text: ' 00000473 00000473',
					},
				],
			},
			{
				// Native COMM frames keep the same values; first match must not win.
				'ID3v2.4': [
					{
						id: 'COMM',
						value: { language: 'eng', descriptor: 'iTunPGAP', text: '0' },
					},
					{
						id: 'COMM',
						value: {
							language: 'eng',
							descriptor: 'iTunNORM',
							text: ' 00000473 00000473',
						},
					},
				],
			},
		),
		null,
	)

	expect(description).toBeNull()
})

test('extractDescription uses non-private native COMM when common.comment is empty', () => {
	const description = extractDescription(
		metadataWithCommon(
			{},
			{
				'ID3v2.4': [
					{
						id: 'COMM',
						value: { language: 'eng', descriptor: 'iTunPGAP', text: '0' },
					},
					{
						id: 'COMM',
						value: {
							language: 'eng',
							descriptor: '',
							text: 'Native comment description',
						},
					},
				],
			},
		),
		null,
	)

	expect(description).toBe('Native comment description')
})
