import { expect, mock, test } from 'bun:test'

const scanAllMediaRootsMock = mock(async () => [])
const resolveMediaPathMock = mock(() => null)
const listMediaPopularityMetricsMock = mock(() => new Map())

mock.module('#app/helpers/media.ts', () => ({
	scanAllMediaRoots: scanAllMediaRootsMock,
}))

mock.module('#app/config/env.ts', () => ({
	resolveMediaPath: resolveMediaPathMock,
}))

mock.module('#app/db/feed-analytics-events.ts', () => ({
	listMediaPopularityMetrics: listMediaPopularityMetricsMock,
}))

test('media api includes popularity metrics for each media item', async () => {
	const { default: handler } = await import('./media.ts')

	scanAllMediaRootsMock.mockResolvedValueOnce([
		{
			path: '/library/audio/book-one.wav',
			filename: 'book-one.wav',
			directory: '/library/audio',
			title: 'Book One',
			author: 'Author A',
			duration: 100,
			publicationDate: new Date('2024-01-01T00:00:00.000Z'),
			trackNumber: null,
			description: null,
			narrators: null,
			genres: null,
			copyright: null,
			sizeBytes: 123,
			mimeType: 'audio/wav',
			fileModifiedAt: 2_000,
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
		},
		{
			path: '/library/audio/book-two.wav',
			filename: 'book-two.wav',
			directory: '/library/audio',
			title: 'Book Two',
			author: null,
			duration: null,
			publicationDate: null,
			trackNumber: null,
			description: null,
			narrators: null,
			genres: null,
			copyright: null,
			sizeBytes: 456,
			mimeType: 'audio/wav',
			fileModifiedAt: 1_000,
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
		},
	])
	resolveMediaPathMock
		.mockReturnValueOnce({
			root: { name: 'audio' },
			relativePath: 'books/book-one.wav',
		})
		.mockReturnValueOnce({
			root: { name: 'audio' },
			relativePath: 'books/book-two.wav',
		})
	listMediaPopularityMetricsMock.mockReturnValueOnce(
		new Map([
			[
				'audio:books/book-one.wav',
				{
					mediaRequests: 9,
					downloadStarts: 4,
					uniqueClients: 2,
					lastSeenAt: 1_700_000_000,
				},
			],
		]),
	)

	const response = await handler.handler()
	const payload = await response.json()

	expect(response.status).toBe(200)
	expect(payload.items).toEqual([
		expect.objectContaining({
			title: 'Book One',
			rootName: 'audio',
			relativePath: 'books/book-one.wav',
			popularityScore: 409,
			mediaRequests: 9,
			downloadStarts: 4,
			lastPlayedAt: 1_700_000_000,
		}),
		expect.objectContaining({
			title: 'Book Two',
			rootName: 'audio',
			relativePath: 'books/book-two.wav',
			popularityScore: 0,
			mediaRequests: 0,
			downloadStarts: 0,
			lastPlayedAt: null,
		}),
	])
})
