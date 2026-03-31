import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { spyOn } from '#test/bun-test-compat.ts'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import * as artworkHelpers from '#app/helpers/artwork.ts'
import * as feedArtworkHelpers from '#app/helpers/feed-artwork.ts'
import { getPodcastArtPlaceholderBytes } from '#app/helpers/podcast-art-placeholder.ts'
import * as squareArtworkHelpers from '#app/helpers/square-artwork.ts'
import { setEnvVar, unsetEnvVar, writeTextFile } from '#test/test-helpers.ts'
import artHandler from './art.ts'

migrate(db)

type ArtActionContext = Parameters<typeof artHandler.handler>[0]
type MinimalArtActionContext = {
	request: Request
	method: string
	url: URL
	params: Record<string, string>
}

function asActionContext(context: MinimalArtActionContext): ArtActionContext {
	return context as ArtActionContext
}

async function createArtRouteTestContext(): Promise<{
	token: string
	[Symbol.asyncDispose]: () => Promise<void>
}> {
	const feed = await createDirectoryFeed({
		name: `art-route-test-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:test'],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Art route token',
	})

	return {
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await deleteDirectoryFeed(feed.id)
		},
	}
}

async function createFileArtRouteTestContext(): Promise<{
	feedId: string
	rootName: string
	relativePath: string
	token: string
	[Symbol.asyncDispose]: () => Promise<void>
}> {
	const previousMediaPaths = process.env.MEDIA_PATHS
	const rootName = `art-route-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'episode.mp3'
	const filePath = path.join(rootPath, relativePath)

	mkdirSync(rootPath, { recursive: true })
	await writeTextFile(filePath, 'art route media fixture')

	setEnvVar('MEDIA_PATHS', `${rootName}:${rootPath}`)
	initEnv()

	const feed = await createDirectoryFeed({
		name: `art-route-file-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: [rootName],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'File art route token',
	})

	return {
		feedId: feed.id,
		rootName,
		relativePath,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await deleteDirectoryFeed(feed.id)

			if (previousMediaPaths === undefined) {
				unsetEnvVar('MEDIA_PATHS')
			} else {
				setEnvVar('MEDIA_PATHS', previousMediaPaths)
			}
			initEnv()

			rmSync(rootPath, { recursive: true, force: true })
		},
	}
}

test('art route rejects malformed path encoding', async () => {
	await using ctx = await createArtRouteTestContext()
	const request = new Request(`http://localhost/art/${ctx.token}/%E0%A4%A`)
	const response = await artHandler.handler(
		asActionContext({
			request,
			method: 'GET',
			url: new URL(request.url),
			params: {
				token: ctx.token,
				path: '%E0%A4%A',
			},
		}),
	)

	expect(response.status).toBe(400)
	expect(await response.text()).toBe('Invalid path encoding')
})

test('art route serves PNG placeholder for feed artwork when no artwork exists', async () => {
	const feed = await createCuratedFeed({
		name: `art-route-placeholder-${Date.now()}`,
	})
	const token = await createCuratedFeedToken({
		feedId: feed.id,
		label: 'Placeholder art token',
	})

	try {
		const request = new Request(`http://localhost/art/${token.token}/feed`)
		const response = await artHandler.handler(
			asActionContext({
				request,
				method: 'GET',
				url: new URL(request.url),
				params: {
					token: token.token,
					path: 'feed',
				},
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('image/png')
		const body = Buffer.from(await response.arrayBuffer())
		expect(body.equals(getPodcastArtPlaceholderBytes())).toBe(true)
	} finally {
		await deleteCuratedFeed(feed.id)
	}
})

test('art route falls back to uploaded feed artwork when embedded squaring fails', async () => {
	await using ctx = await createFileArtRouteTestContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	using _restoreConsoleErrorSpy = {
		[Symbol.dispose]: () => {
			consoleErrorSpy.mockRestore()
		},
	}
	const extractArtworkSpy = spyOn(
		artworkHelpers,
		'extractArtwork',
	).mockResolvedValue({
		data: Buffer.from('embedded-artwork'),
		mimeType: 'image/jpeg',
	})
	using _restoreExtractArtworkSpy = {
		[Symbol.dispose]: () => {
			extractArtworkSpy.mockRestore()
		},
	}
	const getSquareArtworkSpy = spyOn(
		squareArtworkHelpers,
		'getSquareArtwork',
	).mockImplementation(async ({ sourceKey }) => {
		if (sourceKey.startsWith('embedded:')) {
			throw new Error('Corrupt embedded artwork')
		}

		return {
			data: Buffer.from('unexpected-square-artwork'),
			mimeType: 'image/png',
		}
	})
	using _restoreGetSquareArtworkSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkSpy.mockRestore()
		},
	}
	const getFeedArtworkPathSpy = spyOn(
		feedArtworkHelpers,
		'getFeedArtworkPath',
	).mockResolvedValue({
		path: '/tmp/fake-feed-artwork.png',
		mimeType: 'image/png',
	})
	using _restoreGetFeedArtworkPathSpy = {
		[Symbol.dispose]: () => {
			getFeedArtworkPathSpy.mockRestore()
		},
	}
	const uploadedArtwork = Buffer.from('uploaded-feed-artwork')
	const getSquareArtworkFromFileSpy = spyOn(
		squareArtworkHelpers,
		'getSquareArtworkFromFile',
	).mockResolvedValue({
		data: uploadedArtwork,
		mimeType: 'image/png',
	})
	using _restoreGetSquareArtworkFromFileSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkFromFileSpy.mockRestore()
		},
	}

	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const request = new Request(`http://localhost/art/${ctx.token}/${pathParam}`)
	const response = await artHandler.handler(
		asActionContext({
			request,
			method: 'GET',
			url: new URL(request.url),
			params: {
				token: ctx.token,
				path: pathParam,
			},
		}),
	)

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/png')
	const body = Buffer.from(await response.arrayBuffer())
	expect(body.equals(uploadedArtwork)).toBe(true)
	expect(getSquareArtworkFromFileSpy).toHaveBeenCalledWith({
		filePath: '/tmp/fake-feed-artwork.png',
		mimeType: 'image/png',
	})
	expect(consoleErrorSpy).toHaveBeenCalled()
})

test('art route serves placeholder when uploaded feed artwork squaring fails', async () => {
	await using ctx = await createFileArtRouteTestContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	using _restoreConsoleErrorSpy = {
		[Symbol.dispose]: () => {
			consoleErrorSpy.mockRestore()
		},
	}
	const extractArtworkSpy = spyOn(
		artworkHelpers,
		'extractArtwork',
	).mockResolvedValue(null)
	using _restoreExtractArtworkSpy = {
		[Symbol.dispose]: () => {
			extractArtworkSpy.mockRestore()
		},
	}
	const getFeedArtworkPathSpy = spyOn(
		feedArtworkHelpers,
		'getFeedArtworkPath',
	).mockResolvedValue({
		path: '/tmp/broken-feed-artwork.png',
		mimeType: 'image/png',
	})
	using _restoreGetFeedArtworkPathSpy = {
		[Symbol.dispose]: () => {
			getFeedArtworkPathSpy.mockRestore()
		},
	}
	const getSquareArtworkFromFileSpy = spyOn(
		squareArtworkHelpers,
		'getSquareArtworkFromFile',
	).mockRejectedValue(new Error('Corrupt uploaded feed artwork'))
	using _restoreGetSquareArtworkFromFileSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkFromFileSpy.mockRestore()
		},
	}

	const pathParam = `${ctx.rootName}/${ctx.relativePath}`
	const request = new Request(`http://localhost/art/${ctx.token}/${pathParam}`)
	const response = await artHandler.handler(
		asActionContext({
			request,
			method: 'GET',
			url: new URL(request.url),
			params: {
				token: ctx.token,
				path: pathParam,
			},
		}),
	)

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/png')
	const body = Buffer.from(await response.arrayBuffer())
	expect(body.equals(getPodcastArtPlaceholderBytes())).toBe(true)
	expect(consoleErrorSpy).toHaveBeenCalled()
})
