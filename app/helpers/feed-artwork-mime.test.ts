import { expect, test } from 'vitest'
import { type MediaFile } from '#app/helpers/media.ts'
import { PODCAST_ART_PLACEHOLDER_CONTENT_TYPE } from '#app/helpers/podcast-art-placeholder.ts'
import { resolveFeedArtworkMimeType } from './feed-artwork-mime.ts'

function mediaFile(
	overrides: Partial<MediaFile> & Pick<MediaFile, 'path'>,
): MediaFile {
	return {
		filename: 'episode.m4b',
		directory: '/tmp',
		title: 'Episode',
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

test('resolveFeedArtworkMimeType prefers uploaded feed artwork', () => {
	expect(
		resolveFeedArtworkMimeType({
			uploadedFeedArtworkMimeType: 'image/webp',
			items: [mediaFile({ path: '/a', artworkMimeType: 'image/png' })],
		}),
	).toBe('image/webp')
})

test('resolveFeedArtworkMimeType falls back to first item embedded artwork', () => {
	expect(
		resolveFeedArtworkMimeType({
			uploadedFeedArtworkMimeType: null,
			items: [
				mediaFile({ path: '/a', artworkMimeType: null }),
				mediaFile({ path: '/b', artworkMimeType: 'image/png' }),
			],
		}),
	).toBe('image/png')
})

test('resolveFeedArtworkMimeType falls back to PNG placeholder', () => {
	expect(
		resolveFeedArtworkMimeType({
			uploadedFeedArtworkMimeType: null,
			items: [mediaFile({ path: '/a', artworkMimeType: null })],
		}),
	).toBe(PODCAST_ART_PLACEHOLDER_CONTENT_TYPE)
})
