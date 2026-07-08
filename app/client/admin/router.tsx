import {
	addEventListeners,
	type Handle,
	type RemixNode,
	TypedEventTarget,
} from 'remix/ui'
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

type RouteMatch = {
	path: string
	params: Record<string, string>
}

type RouteComponent = (handle: Handle<any>) => () => RemixNode

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
	#currentPath: string = '/admin'
	#currentHref: string = '/admin'
	#started = false

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
	 * Navigate to a new path using the Navigation API.
	 */
	navigate(path: string) {
		this.#commitNavigation(path, 'push', true)
	}

	replace(path: string) {
		if (!isBrowser()) return
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

	start() {
		if (this.#started || !isBrowser()) return
		this.#started = true
		this.syncToCurrentLocation(false)
		if (!window.navigation) return
		window.navigation.addEventListener('navigate', this.handleNavigation)
	}

	syncToCurrentLocation(notify: boolean = false) {
		if (!isBrowser()) return
		this.#syncToUrl(new URL(window.location.href), notify)
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
		if (!isBrowser()) return
		const target = normalizeNavigationTarget(path, window.location.origin)
		if (!target) return
		if (getRelativeHref(target) === getWindowLocationHref()) return

		if (!window.navigation) {
			if (historyMode === 'replace') {
				window.location.replace(target.href)
			} else {
				window.location.assign(target.href)
			}
			return
		}

		const transition = window.navigation.navigate(target.href, {
			history: historyMode,
			info: { notify },
		})
		const navigationContext = {
			targetHref: target.href,
			historyMode,
			notify,
		}
		void transition.committed?.catch((error) => {
			console.error('Navigation commit failed:', navigationContext, error)
		})
		void transition.finished?.catch((error) => {
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

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(handle: Handle<{ url: string }>) {
	let ready = false
	if (isBrowser()) {
		router.start()
		router.syncToCurrentLocation(false)
		handle.queueTask(() => {
			ready = true
			handle.update()
		})
	}

	// Subscribe to navigation events
	addEventListeners(router, handle.signal, {
		navigate: () => {
			void handle.update()
		},
	})

	return () => {
		if (!ready) {
			return (
				<div aria-busy="true" data-admin-route-placeholder="">
					Loading admin route...
				</div>
			)
		}
		const result = router.match()
		if (!result) {
			return <div>404 - Not Found</div>
		}
		const { route, match } = result
		const Component = route.component
		return <Component params={match.params} />
	}
}

function isBrowser() {
	return typeof window !== 'undefined'
}
