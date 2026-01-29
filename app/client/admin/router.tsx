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
	navigate(href: string) {
		const url = new URL(href, window.location.origin)
		if (url.origin !== window.location.origin) return

		if (url.pathname === this.#currentPath) {
			// Still update the URL (search/hash) without re-rendering.
			history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
			return
		}

		history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
		this.#currentPath = url.pathname
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

/**
 * Link component for navigation.
 */
export function Link() {
	return (props: { href: string } & Record<string, unknown>) => {
		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented) return
			if (event.button !== 0) return
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

			const anchor = event.currentTarget as HTMLAnchorElement | null
			if (!anchor) return
			if (anchor.target && anchor.target !== '_self') return
			if (anchor.hasAttribute('download')) return

			const url = new URL(anchor.href, window.location.origin)
			if (url.origin !== window.location.origin) return

			event.preventDefault()
			router.navigate(`${url.pathname}${url.search}${url.hash}`)
		}

		return <a {...props} on={{ click: onClick }} />
	}
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(handle: Handle) {
	// Subscribe to navigation events
	handle.on(router, { navigate: () => handle.update() })

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
