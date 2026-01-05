import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
	getFileMetadata,
	getMediaPaths,
	isMediaFile,
	scanDirectory,
	scanDirectoryWithMetadata,
} from './media.ts'

const TEST_AUDIO_DIR = './test/fixtures/audio'
const TEST_VIDEO_DIR = './test/fixtures/video'

describe('getMediaPaths', () => {
	const originalMediaPaths = process.env.MEDIA_PATHS

	afterEach(() => {
		if (originalMediaPaths !== undefined) {
			process.env.MEDIA_PATHS = originalMediaPaths
		} else {
			delete process.env.MEDIA_PATHS
		}
	})

	test('returns empty array when MEDIA_PATHS is not set', () => {
		delete process.env.MEDIA_PATHS
		expect(getMediaPaths()).toEqual([])
	})

	test('returns empty array when MEDIA_PATHS is empty string', () => {
		process.env.MEDIA_PATHS = ''
		expect(getMediaPaths()).toEqual([])
	})

	test('parses single path', () => {
		process.env.MEDIA_PATHS = '/media/audio'
		expect(getMediaPaths()).toEqual(['/media/audio'])
	})

	test('parses multiple colon-separated paths', () => {
		process.env.MEDIA_PATHS = '/media/audio:/media/video:/media/podcasts'
		expect(getMediaPaths()).toEqual([
			'/media/audio',
			'/media/video',
			'/media/podcasts',
		])
	})

	test('trims whitespace from paths', () => {
		process.env.MEDIA_PATHS = ' /media/audio : /media/video '
		expect(getMediaPaths()).toEqual(['/media/audio', '/media/video'])
	})

	test('filters out empty segments', () => {
		process.env.MEDIA_PATHS = '/media/audio::/media/video:'
		expect(getMediaPaths()).toEqual(['/media/audio', '/media/video'])
	})
})

describe('isMediaFile', () => {
	test('returns true for m4b audiobook file', async () => {
		const testFile = path.join(TEST_AUDIO_DIR, 'Inkheart.m4b')
		const result = await isMediaFile(testFile)
		expect(result).toBe(true)
	})

	test('returns true for mp3 file', async () => {
		const testFile = path.join(
			TEST_AUDIO_DIR,
			'On the Edge of the Dark Sea of Darkness.mp3',
		)
		const result = await isMediaFile(testFile)
		expect(result).toBe(true)
	})

	test('returns true for mkv video file', async () => {
		const testFile = path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')
		const result = await isMediaFile(testFile)
		expect(result).toBe(true)
	})

	test('returns false for non-existent file', async () => {
		const result = await isMediaFile('/nonexistent/file.mp3')
		expect(result).toBe(false)
	})

	test('returns false for non-media file', async () => {
		// Use package.json as a non-media file
		const result = await isMediaFile('./package.json')
		expect(result).toBe(false)
	})
})

describe('scanDirectory', () => {
	test('finds audio files in test directory', async () => {
		const files = await scanDirectory(TEST_AUDIO_DIR)

		expect(files.length).toBeGreaterThan(0)

		// All returned paths should be absolute
		for (const file of files) {
			expect(path.isAbsolute(file)).toBe(true)
		}
	})

	test('finds video files in test directory', async () => {
		const files = await scanDirectory(TEST_VIDEO_DIR)

		expect(files.length).toBeGreaterThan(0)
		expect(files.some((f) => f.includes('Toy Story'))).toBe(true)
	})

	test('returns empty array for non-existent directory', async () => {
		const files = await scanDirectory('/nonexistent/directory')
		expect(files).toEqual([])
	})

	test('returns empty array for empty directory', async () => {
		// Create temp empty dir
		const tempDir = './test/fixtures/empty-test-dir'
		await Bun.write(`${tempDir}/.gitkeep`, '')

		const files = await scanDirectory(tempDir)
		// .gitkeep is not a media file, so should be empty
		expect(files).toEqual([])

		// Cleanup
		await Bun.$`rm -rf ${tempDir}`
	})
})

describe('getFileMetadata', () => {
	test('extracts metadata from m4b audiobook', async () => {
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

	test('extracts metadata from mp3 file', async () => {
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

	test('extracts metadata from mkv video', async () => {
		const testFile = path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')
		const metadata = await getFileMetadata(testFile)

		expect(metadata).not.toBeNull()
		if (!metadata) return

		expect(metadata.mimeType).toMatch(/video/)
		expect(metadata.filename).toBe('Toy Story.mkv')
	})

	test('returns null for non-existent file', async () => {
		const metadata = await getFileMetadata('/nonexistent/file.mp3')
		expect(metadata).toBeNull()
	})

	test('returns null for non-media file', async () => {
		const metadata = await getFileMetadata('./package.json')
		expect(metadata).toBeNull()
	})
})

describe('scanDirectoryWithMetadata', () => {
	test('returns metadata for all media files in directory', async () => {
		const files = await scanDirectoryWithMetadata(TEST_AUDIO_DIR)

		expect(files.length).toBeGreaterThan(0)

		for (const file of files) {
			expect(file.path).toBeTruthy()
			expect(file.filename).toBeTruthy()
			expect(file.mimeType).toBeTruthy()
			expect(file.sizeBytes).toBeGreaterThan(0)
		}
	})

	test('returns empty array for directory with no media', async () => {
		// Use a directory that exists but has no media files
		const files = await scanDirectoryWithMetadata('./app/db')
		expect(files).toEqual([])
	})
})
