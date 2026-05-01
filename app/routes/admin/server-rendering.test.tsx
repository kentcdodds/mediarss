import { expect, test, vi } from 'vitest'
import '#app/config/init-env.ts'
import { type MediaFile } from '#app/helpers/media.ts'

const { scanAllMediaRootsMock } = vi.hoisted(() => ({
	scanAllMediaRootsMock: vi.fn<() => Promise<Array<MediaFile>>>(async () => []),
}))

vi.mock('#app/helpers/media.ts', () => ({
	scanAllMediaRoots: scanAllMediaRootsMock,
	scanDirectory: vi.fn<() => Promise<Array<MediaFile>>>(async () => []),
}))

function createMediaFile(overrides: Partial<MediaFile>): MediaFile {
	return {
		path: 'audio:episode.mp3',
		filename: 'episode.mp3',
		directory: '/media/audio',
		title: 'Episode',
		author: null,
		duration: null,
		publicationDate: null,
		trackNumber: null,
		description: null,
		narrators: null,
		genres: null,
		copyright: null,
		sizeBytes: 123,
		mimeType: 'audio/mpeg',
		fileModifiedAt: 1_700_000_000_000,
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

test('admin media detail preserves exact media paths ending in edit', async () => {
	const { handleAdminRequest } = await import('./server-rendering.tsx')
	scanAllMediaRootsMock.mockResolvedValueOnce([
		createMediaFile({
			path: 'audio:podcasts',
			filename: 'podcasts',
			title: 'Podcasts',
		}),
		createMediaFile({
			path: 'audio:podcasts/edit',
			filename: 'edit',
			title: 'Podcasts Edit Segment',
		}),
	])

	const response = await handleAdminRequest(
		new Request('http://localhost/admin/media/audio:podcasts/edit'),
	)
	const html = await response.text()

	expect(response.status).toBe(200)
	expect(html).toContain('Podcasts Edit Segment')
	expect(html).toContain('audio:podcasts/edit')
	expect(html).not.toContain('<h1>Podcasts</h1>')
})

test('admin media detail edit route falls back to the base media path', async () => {
	const { handleAdminRequest } = await import('./server-rendering.tsx')
	scanAllMediaRootsMock.mockResolvedValueOnce([
		createMediaFile({
			path: 'audio:podcasts',
			filename: 'podcasts',
			title: 'Podcasts',
		}),
	])

	const response = await handleAdminRequest(
		new Request('http://localhost/admin/media/audio:podcasts/edit'),
	)
	const html = await response.text()

	expect(response.status).toBe(200)
	expect(html).toContain('Podcasts')
	expect(html).toContain('audio:podcasts')
})
