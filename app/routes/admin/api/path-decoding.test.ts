import { expect, test } from 'bun:test'
import '#app/config/init-env.ts'
import artworkHandler from './artwork.ts'
import mediaMetadataHandler from './media.$path.metadata.ts'
import mediaDetailHandler from './media.$path.ts'
import mediaStreamHandler from './media-stream.ts'

type ArtworkActionContext = Parameters<typeof artworkHandler.action>[0]
type MediaDetailActionContext = Parameters<typeof mediaDetailHandler.action>[0]
type MediaMetadataActionContext = Parameters<
	typeof mediaMetadataHandler.action
>[0]
type MediaStreamActionContext = Parameters<typeof mediaStreamHandler.action>[0]

test('admin artwork route rejects malformed path encoding', async () => {
	const request = new Request('http://localhost/admin/api/artwork/%E0%A4%A')
	const response = await artworkHandler.action({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { path: '%E0%A4%A' },
	} as unknown as ArtworkActionContext)

	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')
})

test('admin media-stream route rejects malformed path encoding', async () => {
	const request = new Request(
		'http://localhost/admin/api/media-stream/%E0%A4%A',
	)
	const response = await mediaStreamHandler.action({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { path: '%E0%A4%A' },
	} as unknown as MediaStreamActionContext)

	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')
})

test('admin media detail route rejects malformed path encoding', async () => {
	const request = new Request('http://localhost/admin/api/media/%E0%A4%A')
	const response = await mediaDetailHandler.action({
		request,
		method: 'GET',
		url: new URL(request.url),
		params: { path: '%E0%A4%A' },
	} as unknown as MediaDetailActionContext)

	expect(response.status).toBe(400)
	expect(await response.json()).toEqual({ error: 'Invalid path encoding' })
})

test('admin media metadata route rejects malformed path encoding', async () => {
	const request = new Request(
		'http://localhost/admin/api/media/%E0%A4%A/metadata',
		{
			method: 'PUT',
		},
	)
	const response = await mediaMetadataHandler.action({
		request,
		method: 'PUT',
		url: new URL(request.url),
		params: { path: '%E0%A4%A/metadata' },
	} as unknown as MediaMetadataActionContext)

	expect(response.status).toBe(400)
	expect(await response.json()).toEqual({ error: 'Invalid path encoding' })
})
