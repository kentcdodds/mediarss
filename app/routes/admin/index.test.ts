import '#app/config/init-env.ts'

import { expect, test } from 'vitest'
import routes from '#app/config/routes.ts'
import { createCuratedFeed, deleteCuratedFeed } from '#app/db/curated-feeds.ts'
import router from '#app/router.tsx'

async function fetchAdminRoute(pathname: string) {
	return router.fetch(new Request(`http://localhost${pathname}`))
}

test('admin routes return server-rendered hydrated shell', async () => {
	const response = await fetchAdminRoute(routes.admin.href())
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('text/html')
	expect(body.startsWith('<!DOCTYPE html>')).toBe(true)
	expect(body).toContain('MediaRSS')
	expect(body).toContain('Your Feeds')
	expect(body).not.toContain('data-admin-route-placeholder')
	expect(body).toContain('/app/client/admin/entry.tsx')
	expect(body).toContain('<style data-rmx=')
	expect(body).not.toContain('<div id="root"><head>')
})

test.each([
	['new feed', routes.adminFeedNew.href(), 'Create New Feed'],
	['media list', routes.adminMedia.href(), 'Media Library'],
	['version', routes.adminVersion.href(), 'Version Information'],
])('admin %s route server-renders loader data', async (_, path, content) => {
	const response = await fetchAdminRoute(path)
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(body).toContain(content)
	expect(body).not.toContain('data-admin-route-placeholder')
})

test('admin feed list applies query params during server render', async () => {
	const feed = await createCuratedFeed({ name: 'Needle Feed' })
	try {
		const response = await fetchAdminRoute(`${routes.admin.href()}?q=needle`)
		const body = await response.text()

		expect(response.status).toBe(200)
		expect(body).toContain('value="needle"')
	} finally {
		await deleteCuratedFeed(feed.id)
	}
})

test('admin media list applies query params during server render', async () => {
	const response = await fetchAdminRoute(`${routes.adminMedia.href()}?q=movie`)
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(body).toContain('value="movie"')
})

test.each([
	['feed detail', routes.adminFeed.href({ id: 'feed-1' })],
	['feed edit', routes.adminFeedEdit.href({ id: 'feed-1' })],
	['media detail', routes.adminMediaDetail.href({ path: 'audio/book.m4b' })],
	['media edit', routes.adminMediaEdit.href({ path: 'audio/book.m4b' })],
])('admin %s route still has a server shell fallback', async (_, path) => {
	const response = await fetchAdminRoute(path)
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(body).toContain('/app/client/admin/entry.tsx')
})
