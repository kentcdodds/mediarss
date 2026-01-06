import type { Handle } from '@remix-run/component'
import { TypedEventTarget } from '@remix-run/interaction'

type RouteMatch = {
	path: string
	params: Record<string, string>
}

type Route = {
	pattern: RegExp
	paramNames: Array<string>
	component: (props: { params: Record<string, string> }) => JSX.Element
}

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
	register(
		pattern: string,
		component: (props: { params: Record<string, string> }) => JSX.Element,
	) {
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
		// TODO: force refresh because there's a bug in Remix
		window.location.reload()
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

/**
 * Link component for navigation.
 * Currently uses full page refreshes to work around a Remix DOM bug.
 * TODO: Re-enable client-side navigation once the bug is fixed.
 */
export function Link(renderProps: { href: string } & Record<string, unknown>) {
	return <a {...renderProps} />
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(this: Handle) {
	// Subscribe to navigation events
	this.on(router, { navigate: () => this.update() })

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
