import { addEventListeners, type Handle, TypedEventTarget } from 'remix/ui'
import {
	getRelativeHref,
	isRouterOwnedPath,
	normalizeNavigationTarget,
	shouldInterceptNavigationEvent,
	shouldNotifyNavigationChange,
	shouldNotifyNavigationEvent,
	getNavigationSourceElement,
	type NavigationHistoryBehavior,
	getWindowLocationHref,
} from './router-navigation.ts'

const isBrowser = typeof window !== 'undefined'

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
 * Simple client-side router using the Navigation API.
 * Emits 'navigate' events when the route changes.
 */
class RouterState extends TypedEventTarget<{ navigate: Event }> {
	#routes: Array<Route> = []
	#currentPath: string = isBrowser ? window.location.pathname : '/admin'
	#currentHref: string = isBrowser ? getWindowLocationHref() : '/admin'

	get currentPath() {
		return this.#currentPath
	}

	setLocation(href: string) {
		const url = normalizeNavigationTarget(
			href,
			isBrowser ? window.location.origin : 'http://localhost',
		)
		if (!url) return
		this.#currentPath = url.pathname
		this.#currentHref = getRelativeHref(url)
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
	 * Navigate to a new path using the Navigation API.
	 */
	navigate(path: string) {
		if (!isBrowser) return
		this.#commitNavigation(path, 'push', true)
	}

	replace(path: string) {
		if (!isBrowser) return
		const target = normalizeNavigationTarget(path, window.location.origin)
		if (!target) return
		this.#commitNavigation(
			path,
			'replace',
			shouldNotifyNavigationChange(this.#currentPath, target.pathname, false),
		)
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

	handleNavigation = (event: NavigateEvent) => {
		if (
			!shouldInterceptNavigationEvent({
				canIntercept: event.canIntercept,
				hashChange: event.hashChange,
				downloadRequest: event.downloadRequest,
				formData: event.formData,
				navigationType: event.navigationType,
				sourceElement: getNavigationSourceElement(event),
			})
		) {
			return
		}

		const destination = new URL(event.destination.url)
		if (!isRouterOwnedPath(destination.pathname)) return
		const shouldNotify = shouldNotifyNavigationEvent(event.info)

		event.intercept({
			focusReset: shouldNotify ? 'after-transition' : 'manual',
			scroll: shouldNotify ? 'after-transition' : 'manual',
			handler: async () => {
				this.#syncToUrl(destination, shouldNotify)
			},
		})
	}

	#commitNavigation(
		path: string,
		historyMode: NavigationHistoryBehavior,
		notify: boolean,
	) {
		const target = normalizeNavigationTarget(path, window.location.origin)
		if (!target) return
		if (getRelativeHref(target) === getWindowLocationHref()) return

		const transition = window.navigation.navigate(target.href, {
			history: historyMode,
			info: { notify },
		})
		const navigationContext = {
			targetHref: target.href,
			historyMode,
			notify,
		}
		void transition.committed.catch((error) => {
			console.error('Navigation commit failed:', navigationContext, error)
		})
		void transition.finished.catch((error) => {
			console.error('Navigation transition failed:', navigationContext, error)
		})
	}

	#syncToUrl(url: URL, notify: boolean = true) {
		const nextHref = getRelativeHref(url)
		if (nextHref === this.#currentHref) return

		this.#currentHref = nextHref
		this.#currentPath = url.pathname
		if (notify) {
			this.dispatchEvent(new Event('navigate'))
		}
	}
}

// Singleton router instance
export const router = new RouterState()

export function setAdminRouterPath(href: string) {
	router.setLocation(href)
}

// The admin SPA intentionally requires the Navigation API, matching the Remix
// website's client-side navigation model.
if (isBrowser) {
	window.navigation.addEventListener('navigate', router.handleNavigation)
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(handle: Handle) {
	if (!isBrowser) {
		return () => <div>Loading...</div>
	}

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
