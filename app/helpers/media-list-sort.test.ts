import { expect, test } from 'vitest'
import { sortMediaItems } from './media-list-sort.ts'

type MockMediaItem = {
	path: string
	rootName: string
	relativePath: string
	title: string
	author: string | null
	filename: string
	sizeBytes: number
	duration: number | null
	publicationDate: string | null
	fileModifiedAt: number
	downloadStarts?: number
	mediaRequests?: number
	uniqueClients?: number
}

const mediaItems: Array<MockMediaItem> = [
	{
		path: '/media/alpha.mp3',
		rootName: 'audio',
		relativePath: 'alpha.mp3',
		title: 'Alpha',
		author: 'Zed',
		filename: 'alpha.mp3',
		sizeBytes: 100,
		duration: 10,
		publicationDate: '2021-01-01T00:00:00.000Z',
		fileModifiedAt: 1_000,
	},
	{
		path: '/media/bravo.mp3',
		rootName: 'audio',
		relativePath: 'bravo.mp3',
		title: 'Bravo',
		author: null,
		filename: 'bravo.mp3',
		sizeBytes: 300,
		duration: 30,
		publicationDate: null,
		fileModifiedAt: 3_000,
	},
	{
		path: '/media/charlie.mp3',
		rootName: 'video',
		relativePath: 'charlie.mp3',
		title: 'charlie',
		author: 'Able',
		filename: 'charlie.mp3',
		sizeBytes: 200,
		duration: 20,
		publicationDate: '2023-06-01T00:00:00.000Z',
		fileModifiedAt: 2_000,
	},
]

test('recently-modified sorts by file modification time descending', () => {
	const sorted = sortMediaItems(mediaItems, 'recently-modified')

	expect(sorted.map((item) => item.title)).toEqual([
		'Bravo',
		'charlie',
		'Alpha',
	])
})

test('publication-date-newest prefers newer publication dates and puts nulls last', () => {
	const sorted = sortMediaItems(mediaItems, 'publication-date-newest')

	expect(sorted.map((item) => item.title)).toEqual([
		'charlie',
		'Alpha',
		'Bravo',
	])
})

test('author-az sorts by author and places missing authors last', () => {
	const sorted = sortMediaItems(mediaItems, 'author-az')

	expect(sorted.map((item) => item.title)).toEqual([
		'charlie',
		'Alpha',
		'Bravo',
	])
})

test('largest-first sorts by file size descending', () => {
	const sorted = sortMediaItems(mediaItems, 'largest-first')

	expect(sorted.map((item) => item.title)).toEqual([
		'Bravo',
		'charlie',
		'Alpha',
	])
})

test('most-popular sorts by analytics activity before stable fallback', () => {
	const sorted = sortMediaItems(
		[
			{
				path: '/media/alpha.mp3',
				rootName: 'audio',
				relativePath: 'alpha.mp3',
				title: 'Alpha',
				author: 'Zed',
				filename: 'alpha.mp3',
				sizeBytes: 100,
				duration: 10,
				publicationDate: '2021-01-01T00:00:00.000Z',
				fileModifiedAt: 1_000,
				downloadStarts: 4,
				mediaRequests: 8,
				uniqueClients: 2,
			},
			{
				path: '/media/bravo.mp3',
				rootName: 'audio',
				relativePath: 'bravo.mp3',
				title: 'Bravo',
				author: null,
				filename: 'bravo.mp3',
				sizeBytes: 300,
				duration: 30,
				publicationDate: null,
				fileModifiedAt: 3_000,
				downloadStarts: 2,
				mediaRequests: 5,
				uniqueClients: 3,
			},
			{
				path: '/media/charlie.mp3',
				rootName: 'video',
				relativePath: 'charlie.mp3',
				title: 'charlie',
				author: 'Able',
				filename: 'charlie.mp3',
				sizeBytes: 200,
				duration: 20,
				publicationDate: '2023-06-01T00:00:00.000Z',
				fileModifiedAt: 2_000,
				downloadStarts: 4,
				mediaRequests: 9,
				uniqueClients: 1,
			},
		],
		'most-popular',
	)

	expect(sorted.map((item) => item.title)).toEqual([
		'charlie',
		'Alpha',
		'Bravo',
	])
})
