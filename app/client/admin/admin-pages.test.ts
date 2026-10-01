import { expect, test } from 'vitest'
import { routes } from '#app/routes.ts'
import { matchAdminPage, type AdminPage } from './admin-pages.ts'

const pages = [
	{ route: routes.admin, component: 'feeds' },
	{ route: routes.adminFeedNew, component: 'create' },
	{ route: routes.adminFeedEdit, component: 'feedDetail' },
	{ route: routes.adminFeed, component: 'feedDetail' },
	{ route: routes.adminMedia, component: 'mediaList' },
	{ route: routes.adminMediaEdit, component: 'mediaDetail' },
	{ route: routes.adminMediaDetail, component: 'mediaDetail' },
	{ route: routes.adminVersion, component: 'version' },
] satisfies ReadonlyArray<AdminPage<string>>

test.each([
	['/admin', 'feeds'],
	['/admin/feeds/new', 'create'],
	['/admin/media', 'mediaList'],
	['/admin/version', 'version'],
	['/admin/version?x=1#h', 'version'],
])('matches %s to %s', (pathname, component) => {
	expect(matchAdminPage(pages, `http://localhost${pathname}`)?.component).toBe(
		component,
	)
})

test.each([
	['/admin/feeds/5', 'feedDetail'],
	['/admin/feeds/5/edit', 'feedDetail'],
])('matches feed detail params for %s', (pathname, component) => {
	expect(matchAdminPage(pages, `http://localhost${pathname}`)).toEqual({
		component,
		params: { id: '5' },
	})
})

test('matches media detail params', () => {
	expect(
		matchAdminPage(pages, 'http://localhost/admin/media/audio/a%20b.mp3'),
	).toEqual({
		component: 'mediaDetail',
		params: { path: 'audio/a b.mp3' },
	})
})

test('matches media edit before the detail wildcard', () => {
	expect(
		matchAdminPage(pages, 'http://localhost/admin/media/audio/x.m4b/edit'),
	).toEqual({
		component: 'mediaDetail',
		params: { path: 'audio/x.m4b' },
	})
})

test('returns null when no admin page matches', () => {
	expect(matchAdminPage(pages, 'http://localhost/admin/nope')).toBeNull()
})
