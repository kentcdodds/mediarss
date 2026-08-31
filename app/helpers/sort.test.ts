import { expect, test } from 'vitest'
import { extractPublicationDate, type MediaFile } from '#app/helpers/media.ts'
import { sortMediaFiles } from './sort.ts'

function metadataWithCommon(
	common: Record<string, unknown>,
): Parameters<typeof extractPublicationDate>[0] {
	return {
		common: {
			track: { no: null, of: null },
			disk: { no: null, of: null },
			movementIndex: { no: null, of: null },
			...common,
		},
		format: { trackInfo: [], tagTypes: [] },
		native: {},
		quality: { warnings: [] },
	}
}

function mediaFile(
	overrides: Partial<MediaFile> & Pick<MediaFile, 'path' | 'title'>,
): MediaFile {
	return {
		filename: overrides.path.split('/').pop() ?? 'episode.m4a',
		directory: overrides.path.split('/').slice(0, -1).join('/') || '/tmp',
		author: null,
		duration: null,
		publicationDate: null,
		trackNumber: null,
		description: null,
		narrators: null,
		genres: null,
		copyright: null,
		sizeBytes: 1,
		mimeType: 'audio/mp4',
		artworkMimeType: null,
		fileModifiedAt: 1,
		album: null,
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
		...overrides,
	}
}

function conferenceTalk(options: {
	title: string
	folder: string
	filename: string
	year: string
	estimatedPublish: string
}): MediaFile {
	const path = `/media/series/General Conference/${options.folder}/${options.filename}`
	const description = `Session: General Conference | Estimated publish: ${options.estimatedPublish} | Source: churchofjesuschrist.org`
	return mediaFile({
		path,
		title: options.title,
		description,
		publicationDate: extractPublicationDate(
			metadataWithCommon({ date: options.year }),
			null,
			{ description, path },
		),
	})
}

test('directory feed sortFields=pubDate,path sortOrder=desc is newest conference first with session order inside a conference', () => {
	// Same construction getDirectoryFeedItems uses: `${sortOrder}:${sortFields}`.
	// Only the first field gets sortOrder; path defaults to asc so 01- stays
	// before 37- when talks share a conference-month pubDate.
	const sortFields = 'pubDate,path'
	const sortOrder = 'desc'

	const items = [
		conferenceTalk({
			title: '2025 April talk',
			folder: '2025-04',
			filename: '01-talk.m4a',
			year: '2025',
			estimatedPublish: '2025-04-05T10:00:00',
		}),
		conferenceTalk({
			title: '2026 April closing',
			folder: '2026-04',
			filename: '37-closing-remarks.m4a',
			year: '2026',
			estimatedPublish: '2026-04-05T14:00:00',
		}),
		conferenceTalk({
			title: '2025 October talk',
			folder: '2025-10',
			filename: '01-talk.m4a',
			year: '2025',
			estimatedPublish: '2025-10-04T10:00:00',
		}),
		conferenceTalk({
			title: '2026 April introduction',
			folder: '2026-04',
			filename: '01-introduction.m4a',
			year: '2026',
			estimatedPublish: '2026-04-04T10:00:00',
		}),
	]

	const sorted = sortMediaFiles(items, `${sortOrder}:${sortFields}`)

	expect(sorted.map((item) => item.title)).toEqual([
		'2026 April introduction',
		'2026 April closing',
		'2025 October talk',
		'2025 April talk',
	])
})
