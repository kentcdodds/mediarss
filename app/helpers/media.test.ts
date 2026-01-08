import { expect, test } from 'bun:test'
import path from 'node:path'
import { initEnv } from '#app/config/env.ts'
import { consoleError, consoleWarn } from '#test/setup.ts'
import {
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
			await Bun.write(`${tempDir}/.gitkeep`, '')
		},
		[Symbol.asyncDispose]: async () => {
			// SWR background revalidation may warn after cleanup deletes the directory
			consoleWarn.mockImplementation(() => {})
			await Bun.$`rm -rf ${tempDir}`
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
	consoleError.mockImplementation(() => {})
	const nonExistentMetadata = await getFileMetadata('/nonexistent/file.mp3')
	expect(nonExistentMetadata).toBeNull()
	expect(consoleError).toHaveBeenCalledTimes(1)
	expect(consoleError.mock.calls[0]?.[0]).toBe(
		'Error getting metadata for /nonexistent/file.mp3:',
	)

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
