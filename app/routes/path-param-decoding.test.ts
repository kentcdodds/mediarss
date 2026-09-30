import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { initEnv } from '#app/config/env.ts'
import {
	createDirectoryFeedToken,
	revokeDirectoryFeedToken,
} from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrateDatabase } from '#app/db/migrate.ts'
import { encodeRelativePath } from '#app/helpers/feed-access.ts'
import { buildItemPodcastArtUrl } from '#app/helpers/podcast-art-url.ts'
import router from '#app/router.tsx'
import { setEnvVar, unsetEnvVar, writeTextFile } from '#test/test-helpers.ts'

await migrateDatabase(db)

const FILE_CONTENTS = 'literal percent fixture bytes'

async function createSpecialFilenameContext(relativePath: string) {
	const previousMediaPaths = process.env.MEDIA_PATHS
	const rootName = `percent-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const rootPath = path.join('/tmp', rootName)
	const filePath = path.join(rootPath, relativePath)

	mkdirSync(path.dirname(filePath), { recursive: true })
	await writeTextFile(filePath, FILE_CONTENTS)

	setEnvVar('MEDIA_PATHS', `${rootName}:${rootPath}`)
	initEnv()

	const feed = await createDirectoryFeed({
		name: `percent-feed-${Date.now()}`,
		directoryPaths: [rootName],
	})
	const token = await createDirectoryFeedToken({
		feedId: feed.id,
		label: 'Percent filename token',
	})

	return {
		rootName,
		token: token.token,
		[Symbol.asyncDispose]: async () => {
			await revokeDirectoryFeedToken(token.token)
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

async function fetchPath(pathname: string) {
	return router.fetch(new Request(`http://localhost${pathname}`))
}

const specialRelativePaths = [
	'Episode #1 + 50%.mp3',
	'Season 100%/Episode %41 & 50%25.mp3',
]

for (const relativePath of specialRelativePaths) {
	test(`public media and art routes serve "${relativePath}"`, async () => {
		await using ctx = await createSpecialFilenameContext(relativePath)
		const encodedRelativePath = encodeURIComponent(relativePath)

		const mediaResponse = await fetchPath(
			`/media/${ctx.token}/${ctx.rootName}/${encodedRelativePath}`,
		)
		expect(mediaResponse.status).toBe(200)
		expect(await mediaResponse.text()).toBe(FILE_CONTENTS)

		const segmentEncodedMediaResponse = await fetchPath(
			`/media/${ctx.token}/${encodeRelativePath(`${ctx.rootName}/${relativePath}`)}`,
		)
		expect(segmentEncodedMediaResponse.status).toBe(200)
		expect(await segmentEncodedMediaResponse.text()).toBe(FILE_CONTENTS)

		const legacyArtResponse = await fetchPath(
			`/art/${ctx.token}/${ctx.rootName}/${encodedRelativePath}`,
		)
		expect(legacyArtResponse.status).toBe(200)

		const decoratedArtUrl = new URL(
			buildItemPodcastArtUrl(
				'http://localhost',
				ctx.token,
				ctx.rootName,
				relativePath,
				1,
				'image/jpeg',
			),
		)
		const decoratedArtResponse = await fetchPath(decoratedArtUrl.pathname)
		expect(decoratedArtResponse.status).toBe(200)
	})

	test(`admin artwork and media-stream routes serve "${relativePath}"`, async () => {
		await using ctx = await createSpecialFilenameContext(relativePath)
		const encodedPath = `${encodeURIComponent(ctx.rootName)}/${encodeURIComponent(relativePath)}`

		const artworkResponse = await fetchPath(`/admin/api/artwork/${encodedPath}`)
		expect(artworkResponse.status).toBe(200)
		expect(artworkResponse.headers.get('Content-Type')).toBe('image/svg+xml')

		const streamResponse = await fetchPath(
			`/admin/api/media-stream/${encodedPath}`,
		)
		expect(streamResponse.status).toBe(200)
		expect(await streamResponse.text()).toBe(FILE_CONTENTS)
	})
}

test('router rejects malformed path encoding before reaching path handlers', async () => {
	await using ctx = await createSpecialFilenameContext('episode.mp3')
	const malformedPaths = [
		`/media/${ctx.token}/${ctx.rootName}/%E0%A4%A`,
		`/media/${ctx.token}/${ctx.rootName}/50%.mp3`,
		`/art/${ctx.token}/${ctx.rootName}/%E0%A4%A`,
		`/mcp/widget/${ctx.token}/${ctx.rootName}/%E0%A4%A`,
		`/admin/api/artwork/${ctx.rootName}/%E0%A4%A`,
		`/admin/api/media-stream/${ctx.rootName}/%E0%A4%A`,
		`/admin/api/media/${ctx.rootName}/%E0%A4%A`,
		`/admin/api/media-analytics/${ctx.rootName}/%E0%A4%A`,
	]

	const statuses = await Promise.all(
		malformedPaths.map(async (malformedPath) => [
			malformedPath,
			(await fetchPath(malformedPath)).status,
		]),
	)
	expect(statuses).toEqual(malformedPaths.map((p) => [p, 404]))
})

test('public media route does not resolve a doubly-decoded path', async () => {
	await using ctx = await createSpecialFilenameContext('A.mp3')

	const response = await fetchPath(
		`/media/${ctx.token}/${ctx.rootName}/${encodeURIComponent('%41.mp3')}`,
	)
	expect(response.status).toBe(404)
})
