import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { resolveFeedArtwork } from './feed-artwork-resolution.ts'
import { getPodcastArtPlaceholderBytes } from './podcast-art-placeholder.ts'

migrate(db)

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
