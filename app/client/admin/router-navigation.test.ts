import { expect, test } from 'vitest'
import {
	getRelativeHref,
	isRouterOwnedPath,
	shouldInterceptNavigationEvent,
} from './router-navigation.ts'

test('isRouterOwnedPath only matches admin SPA paths', () => {
	expect(isRouterOwnedPath('/admin')).toBe(true)
	expect(isRouterOwnedPath('/admin/feeds')).toBe(true)
	expect(isRouterOwnedPath('/admin/media/library')).toBe(true)
	expect(isRouterOwnedPath('/admin/api')).toBe(false)
	expect(isRouterOwnedPath('/admin/api/feeds')).toBe(false)
	expect(isRouterOwnedPath('/admin-api')).toBe(false)
	expect(isRouterOwnedPath('/feed')).toBe(false)
})

test('getRelativeHref returns pathname search and hash', () => {
	const url = new URL('https://example.com/admin/media?q=test&page=2#detail')

	expect(getRelativeHref(url)).toBe('/admin/media?q=test&page=2#detail')
})

test('shouldInterceptNavigation rejects unsupported navigation types', () => {
	expect(
		shouldInterceptNavigationEvent({
			canIntercept: false,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: null,
		}),
	).toBe(false)

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: true,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: null,
		}),
	).toBe(false)

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: 'report.csv',
			formData: null,
			navigationType: 'push',
			sourceElement: null,
		}),
	).toBe(false)

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: new FormData(),
			navigationType: 'push',
			sourceElement: null,
		}),
	).toBe(false)

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'reload',
			sourceElement: null,
		}),
	).toBe(false)
})

test('shouldInterceptNavigation does not ignore missing source elements', () => {
	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: null,
		}),
	).toBe(true)
})

test('shouldInterceptNavigation respects router ignore markers', () => {
	const regularLink = {
		tagName: 'A',
		target: null,
		closest: () => null,
	}
	const ignoredLink = {
		tagName: 'A',
		target: null,
		closest: (selector: string) =>
			selector === '[data-router-ignore]' ? {} : null,
	}

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: regularLink,
		}),
	).toBe(true)

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: ignoredLink,
		}),
	).toBe(false)
})

test('shouldInterceptNavigation respects non-self targets', () => {
	const newTabLink = {
		tagName: 'A',
		target: '_blank',
		closest: () => null,
	}

	expect(
		shouldInterceptNavigationEvent({
			canIntercept: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: 'push',
			sourceElement: newTabLink,
		}),
	).toBe(false)
})
