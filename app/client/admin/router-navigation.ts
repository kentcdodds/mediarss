type ElementLike = {
	tagName?: string
	closest?: (selector: string) => unknown
	getAttribute?: (name: string) => string | null
	target?: string | null
	form?: ElementLike | null
}

type NavigationSourceElement = ElementLike | null

type NavigationInfo = {
	notify?: boolean
}

export type RouterNavigateEventLike = {
	canIntercept: boolean
	hashChange: boolean
	downloadRequest: string | null
	formData: FormData | null
	navigationType: string
	sourceElement: NavigationSourceElement
	info?: unknown
}

export type NavigationHistoryBehavior = 'auto' | 'push' | 'replace'

export const ROUTER_BASE_PATH = '/admin'
const ROUTER_API_BASE_PATH = `${ROUTER_BASE_PATH}/api`

export function getLocationHref(location: {
	pathname: string
	search: string
	hash: string
}): string {
	return `${location.pathname}${location.search}${location.hash}`
}

export function getWindowLocationHref(): string {
	return getLocationHref(window.location)
}

export function getRelativeHref(url: URL): string {
	return `${url.pathname}${url.search}${url.hash}`
}

export function normalizeNavigationTarget(
	path: string,
	origin: string,
): URL | null {
	try {
		const url = new URL(path, origin)
		if (url.origin !== origin) return null
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		return url
	} catch {
		return null
	}
}

export function isRouterOwnedPath(pathname: string): boolean {
	// Intentionally scope SPA interception to admin routes only.
	// Non-admin links/forms should perform normal browser navigation.
	if (
		pathname === ROUTER_API_BASE_PATH ||
		pathname.startsWith(`${ROUTER_API_BASE_PATH}/`)
	) {
		return false
	}
	return (
		pathname === ROUTER_BASE_PATH || pathname.startsWith(`${ROUTER_BASE_PATH}/`)
	)
}

export function shouldIgnoreRouterNavigation(
	element: NavigationSourceElement,
): boolean {
	return element?.closest?.('[data-router-ignore]') != null
}

export function shouldInterceptNavigationEvent(
	event: RouterNavigateEventLike,
): boolean {
	if (!event.canIntercept) return false
	if (event.hashChange) return false
	if (event.downloadRequest !== null) return false
	if (event.formData !== null) return false
	if (event.navigationType === 'reload') return false

	const sourceElement = event.sourceElement
	if (!isElementLike(sourceElement)) return true
	if (shouldIgnoreRouterNavigation(sourceElement)) return false

	return isSelfNavigationTarget(getSourceNavigationTarget(sourceElement))
}

export function shouldNotifyNavigationEvent(info: unknown): boolean {
	if (!info || typeof info !== 'object') return true
	return (info as NavigationInfo).notify !== false
}

function getSourceNavigationTarget(
	sourceElement: NavigationSourceElement,
): string | null {
	if (!isElementLike(sourceElement)) return null

	if (matchesTagName(sourceElement, 'a')) {
		return getElementTarget(sourceElement)
	}
	if (matchesTagName(sourceElement, 'area')) {
		return getElementTarget(sourceElement)
	}
	if (matchesTagName(sourceElement, 'form')) {
		return getElementTarget(sourceElement)
	}
	if (matchesTagName(sourceElement, 'button')) {
		const form = getElementForm(sourceElement)
		return (
			getElementAttribute(sourceElement, 'formtarget') ??
			getElementTarget(form) ??
			null
		)
	}
	if (matchesTagName(sourceElement, 'input')) {
		const form = getElementForm(sourceElement)
		return (
			getElementAttribute(sourceElement, 'formtarget') ??
			getElementTarget(form) ??
			null
		)
	}

	const nearestAnchor = getClosestElement(sourceElement, 'a[href], area[href]')
	if (
		matchesTagName(nearestAnchor, 'a') ||
		matchesTagName(nearestAnchor, 'area')
	) {
		return getElementTarget(nearestAnchor)
	}

	const nearestForm = getClosestElement(sourceElement, 'form')
	if (matchesTagName(nearestForm, 'form')) {
		return getElementTarget(nearestForm)
	}

	return null
}

function getClosestElement(
	element: ElementLike,
	selector: string,
): ElementLike | null {
	const closest = element.closest?.(selector)
	return isElementLike(closest) ? closest : null
}

function isElementLike(value: unknown): value is ElementLike {
	if (!value || typeof value !== 'object') return false
	return typeof (value as ElementLike).closest === 'function'
}

function matchesTagName(
	element: ElementLike | null,
	tagName: string,
): element is ElementLike {
	return element?.tagName?.toLowerCase() === tagName
}

function getElementAttribute(
	element: ElementLike | null,
	name: string,
): string | null {
	if (!element) return null
	if (typeof element.getAttribute === 'function') {
		return element.getAttribute(name)
	}
	return null
}

function getElementTarget(element: ElementLike | null): string | null {
	if (!element) return null
	return getElementAttribute(element, 'target') ?? element.target ?? null
}

function getElementForm(element: ElementLike | null): ElementLike | null {
	if (!element) return null
	return element.form ?? null
}

export function getNavigationSourceElement(
	event: NavigateEvent,
): NavigationSourceElement {
	const sourceElement = (
		event as NavigateEvent & {
			sourceElement?: unknown
		}
	).sourceElement

	return isElementLike(sourceElement) ? sourceElement : null
}

function isSelfNavigationTarget(target: string | null): boolean {
	if (!target) return true
	return target.trim().toLowerCase() === '_self'
}
