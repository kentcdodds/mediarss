import type { Handle } from 'remix/component'
import { TypedEventTarget } from 'remix/interaction'

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

/**
 * Simple client-side router using the History API.
 * Emits 'navigate' events when the route changes.
 */
class RouterState extends TypedEventTarget<{ navigate: Event }> {
	#routes: Array<Route> = []
	#currentPath: string = window.location.pathname
	#currentHref: string = getLocationHref()

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
		if (target.href === this.#currentHref) return
		history.pushState(null, '', target.href)
		this.#currentHref = target.href
		this.#currentPath = target.pathname
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
		this.#currentHref = getLocationHref()
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

	const formData = new FormData(form)
	if (submitter?.name) {
		formData.append(submitter.name, submitter.value)
	}
	const search = new URLSearchParams()
	for (const [key, value] of formData.entries()) {
		search.append(key, String(value))
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
	handle.on(router, {
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
