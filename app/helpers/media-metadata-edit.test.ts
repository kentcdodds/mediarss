import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { type MediaFile } from '#app/helpers/media.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarss-meta-'))
const rootDir = path.join(tmp, 'root')
const outsideDir = path.join(tmp, 'outside')
fs.mkdirSync(path.join(rootDir, 'Conference'), { recursive: true })
fs.mkdirSync(outsideDir, { recursive: true })
fs.writeFileSync(path.join(rootDir, 'Conference', 'talk.mp3'), 'x')
fs.writeFileSync(path.join(outsideDir, 'secret.mp3'), 'x')
fs.symlinkSync(outsideDir, path.join(rootDir, 'escape'))

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

const { updateMetadataMock, getFileMetadataMock, deleteCacheByPrefixMock } =
	vi.hoisted(() => ({
		updateMetadataMock: vi.fn<
			(filePath: string, mimeType: string, metadata: object) => Promise<void>
		>(async () => {}),
		getFileMetadataMock:
			vi.fn<(filePath: string) => Promise<MediaFile | null>>(),
		deleteCacheByPrefixMock: vi.fn<(prefix: string) => Promise<void>>(
			async () => {},
		),
	}))

vi.mock('#app/config/env.ts', () => ({
	getMediaRootByName: (name: string) =>
		name === 'series' ? { name: 'series', path: rootDir } : undefined,
}))
vi.mock('#app/helpers/ffmpeg.ts', () => ({
	updateMetadata: updateMetadataMock,
}))
vi.mock('#app/helpers/media.ts', () => ({
	getFileMetadata: getFileMetadataMock,
}))
vi.mock('#app/cache/cache.ts', () => ({
	deleteCacheByPrefix: deleteCacheByPrefixMock,
}))
vi.mock('#app/db/curated-feeds.ts', () => ({
	listCuratedFeeds: async () => [],
}))
vi.mock('#app/db/directory-feeds.ts', () => ({
	listDirectoryFeeds: async () => [],
	parseDirectoryPaths: () => [],
}))
vi.mock('#app/db/feed-items.ts', () => ({ getItemsForFeed: async () => [] }))

function mediaFile(filePath: string, description: string | null): MediaFile {
	return {
		path: filePath,
		filename: path.basename(filePath),
		directory: path.dirname(filePath),
		title: 'The Sustaining of Church Officers',
		author: 'Dieter F. Uchtdorf',
		duration: 300,
		publicationDate: new Date('2014-04-01T00:00:00.000Z'),
		trackNumber: 8,
		description,
		narrators: null,
		genres: ['Speech'],
		copyright: null,
		sizeBytes: 1,
		mimeType: 'audio/mpeg',
		artworkMimeType: 'image/jpeg',
		fileModifiedAt: 1,
		album: 'April 2014 general conference',
		albumArtist: null,
		composer: null,
		publisher: null,
		discNumber: null,
		totalDiscs: null,
		totalTracks: null,
		language: null,
		series: null,
		seriesPosition: null,
		encodedBy: null,
		subtitle: null,
	} as MediaFile
}

beforeEach(() => {
	updateMetadataMock.mockClear()
	deleteCacheByPrefixMock.mockClear()
	getFileMetadataMock.mockReset()
	getFileMetadataMock.mockImplementation(async (filePath: string) =>
		mediaFile(filePath, null),
	)
})

test('resolveContainedMediaFile accepts a file inside the media root', async () => {
	const { resolveContainedMediaFile } = await import('./media-metadata-edit.ts')
	const result = await resolveContainedMediaFile(
		'series',
		'Conference/talk.mp3',
	)
	expect(result).toEqual({
		ok: true,
		filePath: path.join(rootDir, 'Conference', 'talk.mp3'),
	})
})

test('resolveContainedMediaFile rejects traversal, symlink escape, unknown roots, and directories', async () => {
	const { resolveContainedMediaFile } = await import('./media-metadata-edit.ts')

	const traversal = await resolveContainedMediaFile(
		'series',
		'../outside/secret.mp3',
	)
	expect(traversal).toMatchObject({ ok: false, status: 400 })

	const absolute = await resolveContainedMediaFile(
		'series',
		path.join(outsideDir, 'secret.mp3'),
	)
	expect(absolute).toMatchObject({ ok: false, status: 400 })

	const symlink = await resolveContainedMediaFile('series', 'escape/secret.mp3')
	expect(symlink).toMatchObject({ ok: false, status: 400 })

	const unknownRoot = await resolveContainedMediaFile('nope', 'talk.mp3')
	expect(unknownRoot).toMatchObject({ ok: false, status: 404 })

	const directory = await resolveContainedMediaFile('series', 'Conference')
	expect(directory).toMatchObject({ ok: false, status: 400 })

	const missing = await resolveContainedMediaFile('series', 'Conference/no.mp3')
	expect(missing).toMatchObject({ ok: false, status: 404 })
})

test('applyMediaMetadataUpdate writes only the provided fields and invalidates the cache', async () => {
	const { applyMediaMetadataUpdate } = await import('./media-metadata-edit.ts')
	const filePath = path.join(rootDir, 'Conference', 'talk.mp3')
	const description =
		'Session: Saturday Afternoon Session | Estimated publish: 2014-04-05T14:00:00'
	getFileMetadataMock
		.mockImplementationOnce(async () => mediaFile(filePath, null))
		.mockImplementationOnce(async () => mediaFile(filePath, description))

	const result = await applyMediaMetadataUpdate(
		'series',
		'Conference/talk.mp3',
		{ description },
	)

	expect(updateMetadataMock).toHaveBeenCalledTimes(1)
	expect(updateMetadataMock).toHaveBeenCalledWith(filePath, 'audio/mpeg', {
		description,
	})
	expect(deleteCacheByPrefixMock).toHaveBeenCalledWith(`media:${filePath}`)
	expect(result).toMatchObject({
		ok: true,
		response: {
			media: { description, title: 'The Sustaining of Church Officers' },
		},
	})
})

test('applyMediaMetadataUpdate rejects invalid input without touching the file', async () => {
	const { applyMediaMetadataUpdate } = await import('./media-metadata-edit.ts')

	const badDate = await applyMediaMetadataUpdate(
		'series',
		'Conference/talk.mp3',
		{ date: '2014-13-05' },
	)
	expect(badDate).toMatchObject({ ok: false, status: 400 })

	const timeInDate = await applyMediaMetadataUpdate(
		'series',
		'Conference/talk.mp3',
		{ date: '2014-04-05T14:00:00' },
	)
	expect(timeInDate).toMatchObject({ ok: false, status: 400 })

	const empty = await applyMediaMetadataUpdate(
		'series',
		'Conference/talk.mp3',
		{},
	)
	expect(empty).toMatchObject({
		ok: false,
		status: 400,
		error: 'No metadata fields provided',
	})

	const traversal = await applyMediaMetadataUpdate(
		'series',
		'../outside/secret.mp3',
		{ description: 'nope' },
	)
	expect(traversal).toMatchObject({ ok: false, status: 400 })

	expect(updateMetadataMock).not.toHaveBeenCalled()
})
