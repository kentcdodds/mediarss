import {
	addEventListeners,
	type Handle,
	TypedEventTarget,
} from 'remix/component'
import {
	getRelativeHref,
	isRouterOwnedPath,
	normalizeNavigationTarget,
	shouldInterceptNavigationEvent,
	getNavigationSourceElement,
	type NavigationHistoryBehavior,
	getWindowLocationHref,
} from './router-navigation.ts'

function writeAdminDebugLog(
	hypothesisId: string,
	location: string,
	message: string,
	data: Record<string, unknown>,
) {
	void fetch('/admin/api/debug-log', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			hypothesisId,
			location,
			message,
			data,
			timestamp: Date.now(),
		}),
	}).catch(() => {})
}

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
	#currentPath: string = window.location.pathname
	#currentHref: string = getWindowLocationHref()

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
		this.#commitNavigation(path, 'push')
	}

	replace(path: string) {
		this.#commitNavigation(path, 'replace')
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
		// #region agent log
		writeAdminDebugLog(
			'C',
			'app/client/admin/router.tsx:111',
			'router handleNavigation entry',
			{
				currentHref: this.#currentHref,
				destinationUrl: event.destination.url,
				navigationType: event.navigationType,
				canIntercept: event.canIntercept,
				hashChange: event.hashChange,
			},
		)
		// #endregion
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

		event.intercept({
			handler: async () => {
				this.#syncToUrl(destination)
			},
		})
	}

	#commitNavigation(path: string, historyMode: NavigationHistoryBehavior) {
		const target = normalizeNavigationTarget(path, window.location.origin)
		if (!target) return
		if (getRelativeHref(target) === getWindowLocationHref()) return

		// #region agent log
		writeAdminDebugLog(
			'C',
			'app/client/admin/router.tsx:144',
			'router commitNavigation',
			{
				path,
				historyMode,
				targetHref: target.href,
				currentHref: getWindowLocationHref(),
			},
		)
		// #endregion
		const transition = window.navigation.navigate(target.href, {
			history: historyMode,
		})
		void transition.committed.catch(() => {})
		void transition.finished.catch(() => {})
	}

	#syncToUrl(url: URL) {
		const nextHref = getRelativeHref(url)
		if (nextHref === this.#currentHref) return

		// #region agent log
		writeAdminDebugLog(
			'C',
			'app/client/admin/router.tsx:164',
			'router syncToUrl',
			{
				previousHref: this.#currentHref,
				nextHref,
				nextPathname: url.pathname,
				nextSearch: url.search,
			},
		)
		// #endregion
		this.#currentHref = nextHref
		this.#currentPath = url.pathname
		this.dispatchEvent(new Event('navigate'))
	}
}

// Singleton router instance
export const router = new RouterState()

// The admin SPA intentionally requires the Navigation API, matching the Remix
// website's client-side navigation model.
window.navigation.addEventListener('navigate', router.handleNavigation)

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
