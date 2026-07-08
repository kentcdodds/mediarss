import '#app/config/init-env.ts'

import { expect, test } from 'vitest'
import routes from '#app/config/routes.ts'
import router from '#app/router.tsx'

async function fetchAdminRoute(pathname: string) {
	return router.fetch(new Request(`http://localhost${pathname}`))
}

test('admin routes return server-rendered hydrated shell', async () => {
	const response = await fetchAdminRoute(routes.admin.href())
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('text/html')
	expect(body).toContain('MediaRSS')
	expect(body).toContain('data-admin-route-placeholder')
	expect(body).toContain('/app/client/admin/entry.tsx')
	expect(body).toContain('<style data-rmx=')
	expect(body).not.toContain('<div id="root"><head>')
})

test.each([
	['new feed', routes.adminFeedNew.href()],
	['feed detail', routes.adminFeed.href({ id: 'feed-1' })],
	['feed edit', routes.adminFeedEdit.href({ id: 'feed-1' })],
	['media list', routes.adminMedia.href()],
	['media detail', routes.adminMediaDetail.href({ path: 'audio/book.m4b' })],
	['media edit', routes.adminMediaEdit.href({ path: 'audio/book.m4b' })],
	['version', routes.adminVersion.href()],
])('admin %s route is mapped directly on the server', async (_, path) => {
	const response = await fetchAdminRoute(path)
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(body).toContain('data-admin-route-placeholder')
})
