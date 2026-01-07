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

// isMediaFile tests

test('isMediaFile returns true for m4b audiobook file', async () => {
	const testFile = path.join(TEST_AUDIO_DIR, 'Inkheart.m4b')
	const result = await isMediaFile(testFile)
	expect(result).toBe(true)
})

test('isMediaFile returns true for mp3 file', async () => {
	const testFile = path.join(
		TEST_AUDIO_DIR,
		'On the Edge of the Dark Sea of Darkness.mp3',
	)
	const result = await isMediaFile(testFile)
	expect(result).toBe(true)
})

test('isMediaFile returns true for mkv video file', async () => {
	const testFile = path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')
	const result = await isMediaFile(testFile)
	expect(result).toBe(true)
})

test('isMediaFile returns false for non-existent file', async () => {
	const result = await isMediaFile('/nonexistent/file.mp3')
	expect(result).toBe(false)
})

test('isMediaFile returns false for non-media file', async () => {
	// Use package.json as a non-media file
	const result = await isMediaFile('./package.json')
	expect(result).toBe(false)
})

// scanDirectory tests

test('scanDirectory finds audio files in test directory', async () => {
	const files = await scanDirectory(TEST_AUDIO_DIR)

	expect(files.length).toBeGreaterThan(0)

	// All returned paths should be absolute
	for (const file of files) {
		expect(path.isAbsolute(file)).toBe(true)
	}
})

test('scanDirectory finds video files in test directory', async () => {
	const files = await scanDirectory(TEST_VIDEO_DIR)

	expect(files.length).toBeGreaterThan(0)
	expect(files.some((f) => f.includes('Toy Story'))).toBe(true)
})

test('scanDirectory returns empty array for non-existent directory', async () => {
	// scanDirectory logs a warning for non-existent directories
	// (may be deferred due to SWR caching, so we wait a tick for it to complete)
	consoleWarn.mockImplementation(() => {})

	const files = await scanDirectory('/nonexistent/directory')
	expect(files).toEqual([])

	// Wait for SWR background revalidation to complete
	await new Promise((resolve) => setTimeout(resolve, 10))
})

test('scanDirectory returns empty array for empty directory', async () => {
	// SWR background revalidation may warn after cleanup deletes the directory
	consoleWarn.mockImplementation(() => {})

	// Create temp empty dir
	const tempDir = './test/fixtures/empty-test-dir'
	await Bun.write(`${tempDir}/.gitkeep`, '')

	const files = await scanDirectory(tempDir)
	// .gitkeep is not a media file, so should be empty
	expect(files).toEqual([])

	// Cleanup
	await Bun.$`rm -rf ${tempDir}`

	// Wait for SWR background revalidation to complete
	await new Promise((resolve) => setTimeout(resolve, 10))
})

// getFileMetadata tests

test('getFileMetadata extracts metadata from m4b audiobook', async () => {
	const testFile = path.join(TEST_AUDIO_DIR, 'Inkheart.m4b')
	const metadata = await getFileMetadata(testFile)

	expect(metadata).not.toBeNull()
	if (!metadata) return

	expect(metadata.path).toContain('Inkheart')
	expect(metadata.filename).toBe('Inkheart.m4b')
	expect(metadata.mimeType).toMatch(/audio/)
	expect(metadata.sizeBytes).toBeGreaterThan(0)
	expect(metadata.fileModifiedAt).toBeGreaterThan(0)
	// Title should be from ID3 or fallback to filename
	expect(metadata.title.length).toBeGreaterThan(0)
})

test('getFileMetadata extracts metadata from mp3 file', async () => {
	const testFile = path.join(
		TEST_AUDIO_DIR,
		'On the Edge of the Dark Sea of Darkness.mp3',
	)
	const metadata = await getFileMetadata(testFile)

	expect(metadata).not.toBeNull()
	if (!metadata) return

	expect(metadata.mimeType).toBe('audio/mpeg')
	expect(metadata.sizeBytes).toBeGreaterThan(0)
})

test('getFileMetadata extracts metadata from mkv video', async () => {
	const testFile = path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')
	const metadata = await getFileMetadata(testFile)

	expect(metadata).not.toBeNull()
	if (!metadata) return

	expect(metadata.mimeType).toMatch(/video/)
	expect(metadata.filename).toBe('Toy Story.mkv')
})

test('getFileMetadata returns null for non-existent file', async () => {
	consoleError.mockImplementation(() => {})

	const metadata = await getFileMetadata('/nonexistent/file.mp3')
	expect(metadata).toBeNull()
	expect(consoleError).toHaveBeenCalledTimes(1)
	expect(consoleError.mock.calls[0]?.[0]).toBe(
		'Error getting metadata for /nonexistent/file.mp3:',
	)
})

test('getFileMetadata returns null for non-media file', async () => {
	const metadata = await getFileMetadata('./package.json')
	expect(metadata).toBeNull()
})

// scanDirectoryWithMetadata tests

test('scanDirectoryWithMetadata returns metadata for all media files in directory', async () => {
	const files = await scanDirectoryWithMetadata(TEST_AUDIO_DIR)

	expect(files.length).toBeGreaterThan(0)

	for (const file of files) {
		expect(file.path).toBeTruthy()
		expect(file.filename).toBeTruthy()
		expect(file.mimeType).toBeTruthy()
		expect(file.sizeBytes).toBeGreaterThan(0)
	}
})

test('scanDirectoryWithMetadata returns empty array for directory with no media', async () => {
	// Use a directory that exists but has no media files
	const files = await scanDirectoryWithMetadata('./app/db')
	expect(files).toEqual([])
})
