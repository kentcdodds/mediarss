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
 * Also emits 'routeUpdate' events when route components request a refresh.
 */
class RouterState extends TypedEventTarget<{
	navigate: Event
	routeUpdate: Event
}> {
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
		if (path === this.#currentPath) return
		history.pushState(null, '', path)
		this.#currentPath = path
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

	/**
	 * Request the router outlet to refresh the current route.
	 * Used by route components to signal that their content has changed.
	 * This works around a Remix vdom issue where nested component updates
	 * don't properly update the DOM when triggered during parent re-renders.
	 */
	requestRouteUpdate() {
		this.dispatchEvent(new Event('routeUpdate'))
	}
}

// Singleton router instance
export const router = new RouterState()

// Listen for browser navigation
window.addEventListener('popstate', router.handlePopState)

/**
 * Link component for client-side navigation.
 * Intercepts clicks on internal links and uses the router's navigate method.
 */
export function Link() {
	return (props: { href: string } & Record<string, unknown>) => {
		const { href, ...rest } = props
		return (
			<a
				href={href}
				{...rest}
				on={{
					click: (e: MouseEvent) => {
						// Allow default behavior for external links, modified clicks, or non-left clicks
						if (
							e.ctrlKey ||
							e.metaKey ||
							e.shiftKey ||
							e.altKey ||
							e.button !== 0 ||
							!href.startsWith('/')
						) {
							return
						}
						e.preventDefault()
						router.navigate(href)
					},
				}}
			/>
		)
	}
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 *
 * Each route renders directly without a wrapper. Route components are
 * treated as different types (FeedList vs MediaList), so Remix's vdom
 * replaces them correctly when the route changes.
 *
 * Also listens for 'routeUpdate' events from route components that need
 * to signal their content has changed. This works around a Remix vdom
 * issue where nested component updates don't properly update the DOM.
 */
export function RouterOutlet(handle: Handle) {
	// Subscribe to navigation and routeUpdate events
	handle.on(router, {
		navigate: () => handle.update(),
		routeUpdate: () => handle.update(),
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
