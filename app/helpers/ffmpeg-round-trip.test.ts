import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as mm from 'music-metadata'
import { expect, test } from 'vitest'
import { deleteCacheByPrefix } from '#app/cache/cache.ts'
import { initEnv } from '#app/config/env.ts'
import { updateMetadata } from './ffmpeg.ts'
import { getFileMetadata } from './media.ts'

initEnv()

const FIXTURES = {
	mp3: './test/fixtures/audio/On the Edge of the Dark Sea of Darkness.mp3',
	m4b: './test/fixtures/audio/Inkheart.m4b',
	mkv: './test/fixtures/video/Toy Story.mkv',
}

async function copyFixture(src: string, filename: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'mediarss-ffmpeg-'))
	const dest = path.join(dir, filename)
	await copyFile(src, dest)
	return {
		filePath: dest,
		[Symbol.asyncDispose]: async () => {
			await rm(dir, { recursive: true, force: true })
		},
	}
}

async function nativeIds(filePath: string) {
	const parsed = await mm.parseFile(filePath)
	return Object.values(parsed.native)
		.flat()
		.map((item) => item.id)
}

test('mp3 series writes land on TXXX:series, not TXXX:TXXX:series', async () => {
	await using copied = await copyFixture(FIXTURES.mp3, 'book.mp3')
	const filePath = copied.filePath
	const before = await getFileMetadata(filePath)
	expect(before?.mimeType).toBe('audio/mpeg')

	await updateMetadata(filePath, before!.mimeType, {
		series: 'Wingfeather',
		seriesPosition: '1',
	})
	await deleteCacheByPrefix(`media:${path.resolve(filePath)}`)

	const ids = await nativeIds(filePath)
	expect(ids).toContain('TXXX:series')
	expect(ids).toContain('TXXX:series-part')
	expect(ids.some((id) => id.toLowerCase() === 'txxx:txxx:series')).toBe(false)
	expect(ids.some((id) => id.toLowerCase() === 'txxx:txxx:series-part')).toBe(
		false,
	)

	const after = await getFileMetadata(filePath)
	expect(after?.series).toBe('Wingfeather')
	expect(after?.seriesPosition).toBe('1')
})

test('m4b update stores show/episode_sort and does not claim dropped keys', async () => {
	await using copied = await copyFixture(FIXTURES.m4b, 'book.m4b')
	const filePath = copied.filePath
	const before = await getFileMetadata(filePath)
	expect(before?.mimeType).toMatch(/audio/)

	await updateMetadata(filePath, before!.mimeType, {
		title: 'Probe Title',
		series: 'Inkheart Series',
		seriesPosition: '2',
		narrator: 'Probe Narrator',
		publisher: 'Probe Publisher',
		language: 'en',
		encodedBy: 'Probe Encoder',
		subtitle: 'Probe Subtitle',
	})
	await deleteCacheByPrefix(`media:${path.resolve(filePath)}`)

	const ids = await nativeIds(filePath)
	expect(ids).toContain('tvsh')
	expect(ids).toContain('tves')
	expect(ids).not.toContain('----:com.apple.iTunes:NARRATOR')

	const after = await getFileMetadata(filePath)
	expect(after?.title).toBe('Probe Title')
	expect(after?.series).toBe('Inkheart Series')
	expect(after?.seriesPosition).toBe('2')
	expect(after?.narrators).not.toEqual(['Probe Narrator'])
	expect(after?.publisher).not.toBe('Probe Publisher')
	expect(after?.language).not.toBe('en')
	expect(after?.encodedBy).not.toBe('Probe Encoder')
	expect(after?.subtitle).not.toBe('Probe Subtitle')
})

test('mkv writes are readable from track: ids', async () => {
	await using copied = await copyFixture(FIXTURES.mkv, 'movie.mkv')
	const filePath = copied.filePath
	const before = await getFileMetadata(filePath)
	expect(before?.mimeType).toMatch(/video/)

	await updateMetadata(filePath, before!.mimeType, {
		series: 'Toy Story Series',
		seriesPosition: '1',
		narrator: 'Probe Narrator',
		album: 'Probe Album',
		description: 'Probe Comment',
		date: '2023-11-07',
		publisher: 'Probe Publisher',
		language: 'en',
		encodedBy: 'Probe Encoder',
		subtitle: 'Probe Subtitle',
		composer: 'Probe Composer',
		copyright: 'Probe Copyright',
		discNumber: 2,
	})
	await deleteCacheByPrefix(`media:${path.resolve(filePath)}`)

	const ids = (await nativeIds(filePath)).map((id) => id.toLowerCase())
	expect(ids).toContain('track:show')
	expect(ids).toContain('track:episode_sort')
	expect(ids).toContain('track:lead_performer')

	const after = await getFileMetadata(filePath)
	expect(after?.series).toBe('Toy Story Series')
	expect(after?.seriesPosition).toBe('1')
	expect(after?.narrators).toEqual(['Probe Narrator'])
	expect(after?.album).toBe('Probe Album')
	expect(after?.description).toBe('Probe Comment')
	expect(after?.publicationDate?.toISOString()).toBe('2023-11-07T00:00:00.000Z')
	expect(after?.publisher).toBe('Probe Publisher')
	expect(after?.language).toBe('en')
	expect(after?.encodedBy).toBe('Probe Encoder')
	expect(after?.subtitle).toBe('Probe Subtitle')
	expect(after?.composer).toBe('Probe Composer')
	expect(after?.copyright).toBe('Probe Copyright')
	expect(after?.discNumber).toBe(2)
})

test('mkv year-only date round-trips as UTC January 1', async () => {
	await using copied = await copyFixture(FIXTURES.mkv, 'movie.mkv')
	const filePath = copied.filePath
	const before = await getFileMetadata(filePath)
	expect(before?.mimeType).toMatch(/video/)

	await updateMetadata(filePath, before!.mimeType, { date: '2020' })
	await deleteCacheByPrefix(`media:${path.resolve(filePath)}`)

	const after = await getFileMetadata(filePath)
	expect(after?.publicationDate?.toISOString()).toBe('2020-01-01T00:00:00.000Z')
})
