import {
	addEventListeners,
	type Handle,
	TypedEventTarget,
} from 'remix/component'

type RouteMatch = {
	path: string
	params: Record<string, string>
}

type RouteComponent = (
	handle: Handle,
	setup?: unknown,
) => (props: { params: Record<string, string> }) => JSX.Element

type Route = {
	pattern: RegExp
	paramNames: Array<string>
	component: RouteComponent
}

const ROUTER_BASE_PATH = '/admin'

/**
 * Simple client-side router using the History API.
 * Emits 'navigate' events when the route changes.
 */
class RouterState extends TypedEventTarget<{ navigate: Event }> {
	#routes: Array<Route> = []
	#currentPath: string = window.location.pathname

	get currentPath() {
		return this.#currentPath
	}

	/**
	 * Register a route with a pattern and component.
	 * Pattern supports :param syntax for dynamic segments.
	 */
	register(pattern: string, component: RouteComponent) {
		const paramNames: Array<string> = []
		const regexPattern = pattern
			.replace(/:([^/]+)/g, (_, name) => {
				paramNames.push(name)
				return '([^/]+)'
			})
			.replace(/\*/g, '.*')

		this.#routes.push({
			pattern: new RegExp(`^${regexPattern}$`),
			paramNames,
			component,
		})
	}

	/**
	 * Navigate to a new path using the History API.
	 */
	navigate(path: string) {
		const target = normalizeNavigationTarget(path)
		// Compare against the live location. Other code (e.g. media list filters) uses
		// history.replaceState for query params; a cached href would make navigate() no-op
		// when only ?query differs from what the SPA last pushed.
		if (target.href === getLocationHref()) return
		history.pushState(null, '', target.href)
		this.#currentPath = window.location.pathname
		this.dispatchEvent(new Event('navigate'))
	}

	/**
	 * Match the current path against registered routes.
	 */
	match(): { route: Route; match: RouteMatch } | null {
		for (const route of this.#routes) {
			const result = route.pattern.exec(this.#currentPath)
			if (result) {
				const params: Record<string, string> = {}
				route.paramNames.forEach((name, index) => {
					const value = result[index + 1]
					if (value !== undefined) params[name] = value
				})
				return {
					route,
					match: { path: this.#currentPath, params },
				}
			}
		}
		return null
	}

	/**
	 * Handle browser back/forward navigation.
	 */
	handlePopState = () => {
		this.#currentPath = window.location.pathname
		this.dispatchEvent(new Event('navigate'))
	}
}

// Singleton router instance
export const router = new RouterState()

// Listen for browser navigation
window.addEventListener('popstate', router.handlePopState)
document.addEventListener('click', handleDocumentClick)
document.addEventListener('submit', handleDocumentSubmit)

function getLocationHref(): string {
	return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function normalizeNavigationTarget(path: string): {
	pathname: string
	href: string
} {
	try {
		const url = new URL(path, window.location.origin)
		return {
			pathname: url.pathname,
			href: `${url.pathname}${url.search}${url.hash}`,
		}
	} catch {
		return {
			pathname: window.location.pathname,
			href: getLocationHref(),
		}
	}
}

function shouldIgnoreRouterNavigation(element: Element): boolean {
	return element.closest('[data-router-ignore]') !== null
}

function isRouterOwnedPath(pathname: string): boolean {
	// Intentionally scope SPA interception to admin routes only.
	// Non-admin links/forms should perform normal browser navigation.
	return (
		pathname === ROUTER_BASE_PATH || pathname.startsWith(`${ROUTER_BASE_PATH}/`)
	)
}

function handleDocumentClick(event: MouseEvent) {
	if (event.defaultPrevented) return
	if (event.button !== 0) return
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
	if (!(event.target instanceof Element)) return

	const anchor = event.target.closest('a[href]')
	if (!(anchor instanceof HTMLAnchorElement)) return
	if (shouldIgnoreRouterNavigation(anchor)) return

	const target = anchor.getAttribute('target')?.trim().toLowerCase()
	if (target && target !== '_self') return
	if (anchor.hasAttribute('download')) return

	const href = anchor.getAttribute('href')
	if (!href || href.startsWith('#')) return

	let url: URL
	try {
		url = new URL(href, window.location.href)
	} catch {
		return
	}
	if (url.origin !== window.location.origin) return
	if (!isRouterOwnedPath(url.pathname)) return

	event.preventDefault()
	router.navigate(`${url.pathname}${url.search}${url.hash}`)
}

function getSubmitterElement(
	submitter: SubmitEvent['submitter'],
): HTMLButtonElement | HTMLInputElement | null {
	if (submitter instanceof HTMLButtonElement) return submitter
	if (
		submitter instanceof HTMLInputElement &&
		(submitter.type === 'submit' || submitter.type === 'image')
	) {
		return submitter
	}
	return null
}

function handleDocumentSubmit(event: SubmitEvent) {
	if (event.defaultPrevented) return
	if (!(event.target instanceof HTMLFormElement)) return

	const form = event.target
	if (shouldIgnoreRouterNavigation(form)) return

	const submitter = getSubmitterElement(event.submitter)
	if (submitter && shouldIgnoreRouterNavigation(submitter)) return

	const target =
		submitter?.getAttribute('formtarget') ?? form.getAttribute('target')
	if (target?.trim() && target.trim().toLowerCase() !== '_self') return

	const method = (
		submitter?.getAttribute('formmethod') ??
		form.getAttribute('method') ??
		'get'
	)
		.trim()
		.toLowerCase()
	if (method !== 'get') return

	const action =
		submitter?.getAttribute('formaction') ??
		form.getAttribute('action') ??
		window.location.href
	let url: URL
	try {
		url = new URL(action, window.location.href)
	} catch {
		return
	}
	if (url.origin !== window.location.origin) return
	if (!isRouterOwnedPath(url.pathname)) return

	const formData = new FormData(form)
	if (submitter?.name) {
		formData.append(submitter.name, submitter.value)
	}
	const search = new URLSearchParams()
	for (const [key, value] of formData.entries()) {
		search.append(
			key,
			typeof value === 'string' ? value : (value as { name: string }).name,
		)
	}

	url.search = search.toString()
	event.preventDefault()
	router.navigate(`${url.pathname}${url.search}${url.hash}`)
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(handle: Handle) {
	// Subscribe to navigation events
	addEventListeners(router, handle.signal, {
		navigate: () => {
			void handle.update()
		},
	})

	return () => {
		const result = router.match()
		if (!result) {
			return <div>404 - Not Found</div>
		}
		const { route, match } = result
		const Component = route.component
		return <Component params={match.params} />
	}
}
