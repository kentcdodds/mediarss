import assert from 'node:assert/strict'
import { type ControlContext } from '../control-context.ts'

/**
 * Creates a curated feed from fixture audio, then proves the public RSS URL
 * serves both items. Copy this file as a starting point for a PR's own proof.
 */
export default async function curatedFeed({ json, request }: ControlContext) {
	const feed = await json<{ id: string }>('POST', '/admin/api/feeds/curated', {
		name: `Control fixture ${new Date().toISOString()}`,
		items: [
			'audio:Inkheart.m4b',
			'audio:On the Edge of the Dark Sea of Darkness.mp3',
		],
	})

	const details = await json<{ tokens: Array<{ token: string }> }>(
		'GET',
		`/admin/api/feeds/${feed.id}`,
	)
	const token = details.tokens[0]?.token
	assert.ok(token, 'a new curated feed gets an access token')

	const rssResponse = await request('GET', `/feed/${token}`)
	assert.equal(rssResponse.status, 200)
	const rss = await rssResponse.text()
	assert.match(rss, /<rss/)
	assert.match(rss, /Inkheart/)
	assert.match(rss, /Dark Sea of Darkness/)

	return {
		feedId: feed.id,
		token,
		feedUrl: `/feed/${token}`,
		adminUrl: `/admin/feeds/${feed.id}`,
	}
}
