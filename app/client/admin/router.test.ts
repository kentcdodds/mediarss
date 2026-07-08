import { expect, test } from 'vitest'
import {
	noAdminRouteLoaderData,
	type AdminRouteLoaderData,
} from './loader-data.ts'
import { RouterState, routerEvents } from './router.tsx'

const routeComponent = () => () => ''

test('same-url sync aborts a pending loader navigation', async () => {
	const router = new RouterState()
	const events: Array<string> = []
	const abortController = new AbortController()
	routerEvents.addEventListener(
		'navigationstart',
		() => events.push('navigationstart'),
		{ signal: abortController.signal },
	)
	routerEvents.addEventListener(
		'navigationend',
		() => events.push('navigationend'),
		{ signal: abortController.signal },
	)

	let resolveLoader: (value: AdminRouteLoaderData) => void = () => {}
	router.register('/admin', routeComponent)
	router.register('/admin/slow', routeComponent, ({ signal }) => {
		return new Promise<AdminRouteLoaderData>((resolve, reject) => {
			resolveLoader = resolve
			signal?.addEventListener(
				'abort',
				() => reject(new DOMException('Aborted', 'AbortError')),
				{ once: true },
			)
		})
	})
	router.seed(new URL('http://localhost/admin'), noAdminRouteLoaderData)

	const slowNavigation = router.syncToUrl(
		new URL('http://localhost/admin/slow'),
	)
	await Promise.resolve()
	await router.syncToUrl(new URL('http://localhost/admin'))
	resolveLoader({ type: 'version', data: { version: 'stale' } })
	await slowNavigation

	expect(router.currentHref).toBe('/admin')
	expect(router.loaderData).toBe(noAdminRouteLoaderData)
	expect(events).toEqual([
		'navigationstart',
		'navigationstart',
		'navigationend',
	])
	abortController.abort()
})
