import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { spyOn } from '#test/bun-test-compat.ts'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { addItemToFeed } from '#app/db/feed-items.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { setEnvVar, unsetEnvVar, writeTextFile } from '#test/test-helpers.ts'
import * as artworkHelpers from './artwork.ts'
import * as feedArtworkHelpers from './feed-artwork.ts'
import { resolveFeedArtwork } from './feed-artwork-resolution.ts'
import { getPodcastArtPlaceholderBytes } from './podcast-art-placeholder.ts'
import * as squareArtworkHelpers from './square-artwork.ts'

migrate(db)

async function createFeedArtworkResolutionContext(): Promise<{
	feedId: string
	rootName: string
	filePath: string
	[Symbol.asyncDispose]: () => Promise<void>
}> {
	const previousMediaPaths = process.env.MEDIA_PATHS
	const rootName = `feed-artwork-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const relativePath = 'episode.mp3'
	const filePath = path.join(rootPath, relativePath)

	mkdirSync(rootPath, { recursive: true })
	await writeTextFile(filePath, 'feed artwork media fixture')

	setEnvVar('MEDIA_PATHS', `${rootName}:${rootPath}`)
	initEnv()

	const feed = await createCuratedFeed({
		name: `feed-artwork-resolution-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	})
	await addItemToFeed(feed.id, rootName, relativePath)

	return {
		feedId: feed.id,
		rootName,
		filePath,
		[Symbol.asyncDispose]: async () => {
			await deleteCuratedFeed(feed.id)

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

test('resolveFeedArtwork returns PNG placeholder when feed has no artwork sources', async () => {
	const feed = await createCuratedFeed({
		name: `placeholder-feed-${Date.now()}`,
	})
	try {
		const response = await resolveFeedArtwork(feed.id)
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('image/png')
		const buf = Buffer.from(await response.arrayBuffer())
		const expected = getPodcastArtPlaceholderBytes()
		expect(buf.equals(expected)).toBe(true)
	} finally {
		await deleteCuratedFeed(feed.id)
	}
})

test('resolveFeedArtwork falls back to embedded artwork when uploaded artwork squaring fails', async () => {
	await using ctx = await createFeedArtworkResolutionContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	using _restoreConsoleErrorSpy = {
		[Symbol.dispose]: () => {
			consoleErrorSpy.mockRestore()
		},
	}
	const getFeedArtworkPathSpy = spyOn(
		feedArtworkHelpers,
		'getFeedArtworkPath',
	).mockResolvedValue({
		path: '/tmp/broken-uploaded-artwork.png',
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
	).mockRejectedValue(new Error('Corrupt uploaded artwork'))
	using _restoreGetSquareArtworkFromFileSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkFromFileSpy.mockRestore()
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
	const embeddedArtwork = Buffer.from('embedded-square-artwork')
	const getSquareArtworkSpy = spyOn(
		squareArtworkHelpers,
		'getSquareArtwork',
	).mockResolvedValue({
		data: embeddedArtwork,
		mimeType: 'image/jpeg',
	})
	using _restoreGetSquareArtworkSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkSpy.mockRestore()
		},
	}

	const response = await resolveFeedArtwork(ctx.feedId)

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/jpeg')
	const body = Buffer.from(await response.arrayBuffer())
	expect(body.equals(embeddedArtwork)).toBe(true)
	expect(extractArtworkSpy).toHaveBeenCalledWith(ctx.filePath)
	expect(consoleErrorSpy).toHaveBeenCalled()
})

test('resolveFeedArtwork returns placeholder when embedded artwork squaring fails', async () => {
	await using ctx = await createFeedArtworkResolutionContext()
	const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
	using _restoreConsoleErrorSpy = {
		[Symbol.dispose]: () => {
			consoleErrorSpy.mockRestore()
		},
	}
	const getFeedArtworkPathSpy = spyOn(
		feedArtworkHelpers,
		'getFeedArtworkPath',
	).mockResolvedValue(null)
	using _restoreGetFeedArtworkPathSpy = {
		[Symbol.dispose]: () => {
			getFeedArtworkPathSpy.mockRestore()
		},
	}
	const extractArtworkSpy = spyOn(
		artworkHelpers,
		'extractArtwork',
	).mockResolvedValue({
		data: Buffer.from('broken-embedded-artwork'),
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
	).mockRejectedValue(new Error('Corrupt embedded artwork'))
	using _restoreGetSquareArtworkSpy = {
		[Symbol.dispose]: () => {
			getSquareArtworkSpy.mockRestore()
		},
	}

	const response = await resolveFeedArtwork(ctx.feedId)

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/png')
	const body = Buffer.from(await response.arrayBuffer())
	expect(body.equals(getPodcastArtPlaceholderBytes())).toBe(true)
	expect(extractArtworkSpy).toHaveBeenCalledWith(ctx.filePath)
	expect(consoleErrorSpy).toHaveBeenCalled()
})
