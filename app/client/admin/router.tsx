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
class RouterState extends TypedEventTarget<{
	navigate: Event
	routeUpdate: Event
}> {
	#routes: Array<Route> = []
	#currentPath: string = window.location.pathname
	#patchedHandles = new WeakSet<Handle>()

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

		const wrappedComponent: RouteComponent = (handle, setup) => {
			this.enableRouteUpdates(handle)
			return component(handle, setup)
		}

		this.#routes.push({
			pattern: new RegExp(`^${regexPattern}$`),
			paramNames,
			component: wrappedComponent,
		})
	}

	enableRouteUpdates(handle: Handle) {
		if (this.#patchedHandles.has(handle)) return
		this.#patchedHandles.add(handle)
		const originalUpdate = handle.update.bind(handle)
		handle.update = () => {
			if (handle.signal.aborted) return
			originalUpdate()
			this.requestRouteUpdate()
		}
	}

	/**
	 * Navigate to a new path using the History API.
	 */
	navigate(path: string) {
		const url = new URL(path, window.location.href)
		const nextPath = url.pathname
		const nextUrl = `${url.pathname}${url.search}${url.hash}`
		const currentUrl = `${this.#currentPath}${window.location.search}${window.location.hash}`
		if (nextPath === this.#currentPath && nextUrl === currentUrl) return
		history.pushState(null, '', nextUrl)
		this.#currentPath = nextPath
		this.dispatchEvent(new Event('navigate'))
	}

	/**
	 * Request a RouterOutlet refresh for child updates.
	 */
	requestRouteUpdate() {
		this.dispatchEvent(new Event('routeUpdate'))
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

export function enableRouteUpdates(handle: Handle) {
	router.enableRouteUpdates(handle)
}

/**
 * Link component for navigation.
 * Uses client-side navigation to avoid full page refreshes.
 */
export function Link() {
	return (
		props: {
			href: string
			on?: Record<string, (event: MouseEvent) => void>
		} & Record<string, unknown>,
	) => {
		const { href, on, ...rest } = props
		const handleClick = (event: MouseEvent) => {
			on?.click?.(event)
			if (event.defaultPrevented) return
			if (event.button !== 0) return
			if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
				return
			}
			const anchor = event.currentTarget
			if (!(anchor instanceof HTMLAnchorElement)) return
			if (anchor.target && anchor.target !== '_self') return
			if (anchor.hasAttribute('download')) return
			const url = new URL(href, window.location.href)
			if (url.origin !== window.location.origin) return
			event.preventDefault()
			router.navigate(`${url.pathname}${url.search}${url.hash}`)
		}

		return <a href={href} on={{ ...on, click: handleClick }} {...rest} />
	}
}

/**
 * Router outlet component.
 * Renders the matched route's component.
 */
export function RouterOutlet(handle: Handle) {
	// Subscribe to navigation events
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
