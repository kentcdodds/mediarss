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
	const audioFiles = await scanDirectory(TEST_AUDIO_DIR)
	expect(audioFiles.sort()).toEqual(
		[
			path.resolve(TEST_AUDIO_DIR, 'Inkheart.m4b'),
			path.resolve(
				TEST_AUDIO_DIR,
				'On the Edge of the Dark Sea of Darkness.mp3',
			),
		].sort(),
	)

	const videoFiles = await scanDirectory(TEST_VIDEO_DIR)
	expect(videoFiles).toEqual([path.resolve(TEST_VIDEO_DIR, 'Toy Story.mkv')])

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
	const inkheartPath = path.join(TEST_AUDIO_DIR, 'Inkheart.m4b')
	const inkheartStat = await fs.stat(inkheartPath)
	const m4bMetadata = await getFileMetadata(inkheartPath)
	expect(m4bMetadata!.path).toBe(path.resolve(inkheartPath))
	expect(m4bMetadata!.filename).toBe('Inkheart.m4b')
	expect(m4bMetadata!.title).toBe('Inkheart')
	expect(m4bMetadata!.author).toBe('Cornelia Funke')
	expect(m4bMetadata!.mimeType).toBe('audio/x-m4a')
	expect(m4bMetadata!.sizeBytes).toBe(inkheartStat.size)
	expect(m4bMetadata!.fileModifiedAt).toBe(
		Math.floor(inkheartStat.mtimeMs / 1000),
	)
	expect(m4bMetadata!.publicationDate!.toISOString()).toBe(
		'2004-03-25T00:00:00.000Z',
	)

	const mp3Path = path.join(
		TEST_AUDIO_DIR,
		'On the Edge of the Dark Sea of Darkness.mp3',
	)
	const mp3Stat = await fs.stat(mp3Path)
	const mp3Metadata = await getFileMetadata(mp3Path)
	expect(mp3Metadata!.filename).toBe(
		'On the Edge of the Dark Sea of Darkness.mp3',
	)
	expect(mp3Metadata!.title).toBe(
		'On the Edge of the Dark Sea of Darkness - The Wingfeather Saga, Book 1',
	)
	expect(mp3Metadata!.mimeType).toBe('audio/mpeg')
	expect(mp3Metadata!.sizeBytes).toBe(mp3Stat.size)
	expect(mp3Metadata!.fileModifiedAt).toBe(Math.floor(mp3Stat.mtimeMs / 1000))

	const mkvPath = path.join(TEST_VIDEO_DIR, 'Toy Story.mkv')
	const mkvMetadata = await getFileMetadata(mkvPath)
	expect(mkvMetadata!.filename).toBe('Toy Story.mkv')
	expect(mkvMetadata!.title).toBe('Toy Story')
	expect(mkvMetadata!.mimeType).toBe('video/matroska')
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
	const audioFilesWithMetadata = await scanDirectoryWithMetadata(TEST_AUDIO_DIR)
	expect(audioFilesWithMetadata.map((file) => file.filename).sort()).toEqual([
		'Inkheart.m4b',
		'On the Edge of the Dark Sea of Darkness.mp3',
	])
	const byName = new Map(
		audioFilesWithMetadata.map((file) => [file.filename, file]),
	)
	for (const filename of [
		'Inkheart.m4b',
		'On the Edge of the Dark Sea of Darkness.mp3',
	]) {
		const file = byName.get(filename)!
		const filePath = path.resolve(TEST_AUDIO_DIR, filename)
		const stat = await fs.stat(filePath)
		expect(file.path).toBe(filePath)
		expect(file.sizeBytes).toBe(stat.size)
		expect(file.fileModifiedAt).toBe(Math.floor(stat.mtimeMs / 1000))
	}
	expect(byName.get('Inkheart.m4b')!.mimeType).toBe('audio/x-m4a')
	expect(
		byName.get('On the Edge of the Dark Sea of Darkness.mp3')!.mimeType,
	).toBe('audio/mpeg')

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

test('extractPublicationDate treats year-only values as UTC January 1', () => {
	const fromCommon = extractPublicationDate(
		metadataWithCommon({ date: '2020' }),
	)
	expect(fromCommon!.toISOString()).toBe('2020-01-01T00:00:00.000Z')

	const fromYear = extractPublicationDate(metadataWithCommon({ year: 2020 }))
	expect(fromYear!.toISOString()).toBe('2020-01-01T00:00:00.000Z')

	const fromTrack = extractPublicationDate(
		metadataWithCommon({}, { matroska: [{ id: 'track:DATE', value: '2020' }] }),
	)
	expect(fromTrack!.toISOString()).toBe('2020-01-01T00:00:00.000Z')

	const fromNumericTrack = extractPublicationDate(
		metadataWithCommon({}, { matroska: [{ id: 'track:DATE', value: 2020 }] }),
	)
	expect(fromNumericTrack!.toISOString()).toBe('2020-01-01T00:00:00.000Z')
})

test('extractPublicationDate reads a full Matroska track:DATE as UTC midnight', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon(
			{},
			{ matroska: [{ id: 'track:DATE', value: '2023-11-07' }] },
		),
	)

	expect(publicationDate!.toISOString()).toBe('2023-11-07T00:00:00.000Z')
})

test('extractPublicationDate prefers TDRL releasedate over year-only TDRC date', () => {
	// Podcast files often have TDRC=2026 (year) and TDRL=2026-07-28 (full date).
	// music-metadata maps those to common.date and common.releasedate.
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026',
			releasedate: '2026-07-28',
		}),
	)

	expect(publicationDate!.toISOString()).toBe('2026-07-28T00:00:00.000Z')
})

test('extractPublicationDate prefers releasedate over full common.date', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026-01-01',
			releasedate: '2026-07-28',
		}),
	)

	expect(publicationDate!.toISOString()).toBe('2026-07-28T00:00:00.000Z')
})

test('extractPublicationDate falls back to common.date when releasedate is missing', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2025-03-15',
		}),
	)

	expect(publicationDate!.toISOString()).toBe('2025-03-15T00:00:00.000Z')
})

test('extractPublicationDate prefers the estimated publish timestamp over year-only date', () => {
	// General Conference files are tagged with TDRC=2026 (year) and a
	// description like "Estimated publish: 2026-04-04T10:00:00". April and
	// October of the same year must not collapse to January 1, and the naive
	// time is Mountain time (Salt Lake City).
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026',
		}),
		null,
		{
			description:
				'Session: Saturday Morning Session | Estimated publish: 2026-04-04T10:00:00 | Source: churchofjesuschrist.org',
			path: '/media/series/General Conference/2026-04/01-introduction.m4a',
		},
	)

	expect(publicationDate!.toISOString()).toBe('2026-04-04T16:00:00.000Z')
})

test('extractPublicationDate gives each conference talk its own chronological timestamp', () => {
	const yearOnly = metadataWithCommon({ date: '2026' })
	const saturday = extractPublicationDate(yearOnly, null, {
		description:
			'Session: Saturday Morning Session | Estimated publish: 2026-04-04T10:00:00 | Source: churchofjesuschrist.org',
	})
	const sunday = extractPublicationDate(yearOnly, null, {
		description:
			'Session: Sunday Afternoon Session | Estimated publish: 2026-04-05T14:00:00 | Source: churchofjesuschrist.org',
	})

	const saturdaySecondTalk = extractPublicationDate(yearOnly, null, {
		description:
			'Session: Saturday Morning Session | Estimated publish: 2026-04-04T10:04:00 | Source: churchofjesuschrist.org',
	})

	expect(saturday!.toISOString()).toBe('2026-04-04T16:00:00.000Z')
	expect(saturdaySecondTalk!.toISOString()).toBe('2026-04-04T16:04:00.000Z')
	expect(sunday!.toISOString()).toBe('2026-04-05T20:00:00.000Z')
})

test('extractPublicationDate reads naive estimated publish times as Mountain time across DST', () => {
	const yearOnly = metadataWithCommon({ date: '2006' })
	const october = extractPublicationDate(yearOnly, null, {
		description: 'Estimated publish: 2006-09-30T10:00:00',
	})
	const april = extractPublicationDate(yearOnly, null, {
		// April 1, 2006 was before the 2007 DST rule change, so still MST (UTC-7).
		description: 'Estimated publish: 2006-04-01T10:00:00',
	})
	const explicitUtc = extractPublicationDate(yearOnly, null, {
		description: 'Estimated publish: 2006-04-01T10:00:00Z',
	})

	expect(october!.toISOString()).toBe('2006-09-30T16:00:00.000Z')
	expect(april!.toISOString()).toBe('2006-04-01T17:00:00.000Z')
	expect(explicitUtc!.toISOString()).toBe('2006-04-01T10:00:00.000Z')
})

test('extractPublicationDate keeps fractional seconds in estimated publish times', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({ date: '2026' }),
		null,
		{ description: 'Estimated publish: 2026-04-04T10:00:00.500' },
	)

	expect(publicationDate!.toISOString()).toBe('2026-04-04T16:00:00.500Z')
})

test('extractPublicationDate ignores an invalid estimated publish and falls back to the folder', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({ date: '2026' }),
		null,
		{
			description: 'Estimated publish: 2026-13-04T10:00:00',
			path: '/media/series/General Conference/2026-04/01-introduction.m4a',
		},
	)

	expect(publicationDate!.toISOString()).toBe('2026-04-01T00:00:00.000Z')
})

test('extractPublicationDate keeps a full releasedate over estimated publish', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2026',
			releasedate: '2026-07-28',
		}),
		null,
		{
			description: 'Estimated publish: 2026-04-04T10:00:00',
		},
	)

	expect(publicationDate!.toISOString()).toBe('2026-07-28T00:00:00.000Z')
})

test('extractPublicationDate falls back to YYYY-MM folder when estimated publish is missing', () => {
	const publicationDate = extractPublicationDate(
		metadataWithCommon({
			date: '2025',
		}),
		null,
		{
			path: '/media/series/General Conference/2025-10/01-talk.m4a',
		},
	)

	expect(publicationDate!.toISOString()).toBe('2025-10-01T00:00:00.000Z')
})

test('extractDescription reads Matroska track:COMMENT before iTun* common comments', () => {
	const description = extractDescription(
		metadataWithCommon(
			{
				comment: [{ language: 'eng', descriptor: 'iTunPGAP', text: '0' }],
			},
			{
				matroska: [{ id: 'track:COMMENT', value: 'Matroska comment' }],
			},
		),
		null,
	)

	expect(description).toBe('Matroska comment')
})

test('extractDescription falls back to Matroska track:DESCRIPTION', () => {
	const description = extractDescription(
		metadataWithCommon(
			{},
			{
				matroska: [{ id: 'track:DESCRIPTION', value: 'Matroska description' }],
			},
		),
		null,
	)

	expect(description).toBe('Matroska description')
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
