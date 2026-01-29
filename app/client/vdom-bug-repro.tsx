/**
 * Minimal reproduction attempt for Remix VDOM bug.
 *
 * This page attempts to reproduce a bug where handle.update() doesn't update
 * the DOM when called from a component created during a parent's re-render.
 *
 * However, this simplified reproduction DOES NOT trigger the bug.
 * The bug appears to be specific to more complex scenarios.
 *
 * In the actual router implementation, a workaround was needed:
 * - Route components call router.requestRouteUpdate() instead of handle.update()
 * - RouterOutlet listens for 'routeUpdate' events and calls its own handle.update()
 *
 * See: https://github.com/remix-run/remix/issues/11012
 */

import { createRoot, type Handle } from 'remix/component'
import { TypedEventTarget } from 'remix/interaction'

// Component type matching the router's RouteComponent pattern
type RouteComponent = (
	handle: Handle,
	setup?: unknown,
) => (props: { params: Record<string, string> }) => JSX.Element

/**
 * Mimics the router's state management
 */
class RouterLike extends TypedEventTarget<{
	navigate: Event
	routeUpdate: Event
}> {
	#currentRoute: 'static' | 'async' = 'static'
	#routes: Map<string, RouteComponent> = new Map()

	get currentRoute() {
		return this.#currentRoute
	}

	register(name: string, component: RouteComponent) {
		this.#routes.set(name, component)
	}

	navigate(route: 'static' | 'async') {
		if (route === this.#currentRoute) return
		this.#currentRoute = route
		console.log('[RouterLike] navigate to:', route)
		this.dispatchEvent(new Event('navigate'))
	}

	match(): {
		component: RouteComponent
		params: Record<string, string>
	} | null {
		const component = this.#routes.get(this.#currentRoute)
		if (!component) return null
		return { component, params: {} }
	}

	/**
	 * Workaround: Route components call this instead of handle.update()
	 * to ensure the DOM updates correctly.
	 */
	requestRouteUpdate() {
		this.dispatchEvent(new Event('routeUpdate'))
	}
}

const routerLike = new RouterLike()

/**
 * Async child component that uses handle.update() directly.
 * In the actual router, this approach caused the DOM to not update.
 */
function AsyncChildDirect(handle: Handle) {
	let state: 'loading' | 'loaded' = 'loading'

	console.log('[AsyncChildDirect] setup called')

	setTimeout(() => {
		if (handle.signal.aborted) return
		state = 'loaded'
		console.log('[AsyncChildDirect] calling handle.update(), state:', state)
		handle.update() // Direct handle.update() - may not work in some scenarios
		console.log('[AsyncChildDirect] handle.update() returned')
	}, 500)

	return (props: { params: Record<string, string> }) => {
		console.log(
			'[AsyncChildDirect] render called, state:',
			state,
			'props:',
			props,
		)
		return (
			<div
				css={{
					padding: '20px',
					border: '2px solid #3b82f6',
					borderRadius: '8px',
					backgroundColor: state === 'loading' ? '#fef3c7' : '#d1fae5',
				}}
			>
				<strong>AsyncChildDirect (uses handle.update()):</strong>{' '}
				{state === 'loading' ? '⏳ Loading...' : '✅ Loaded!'}
			</div>
		)
	}
}

/**
 * Static child component - the initial route
 */
function StaticChild() {
	console.log('[StaticChild] setup called')
	return (props: { params: Record<string, string> }) => {
		console.log('[StaticChild] render called, props:', props)
		return (
			<div
				css={{
					padding: '20px',
					border: '2px solid #6b7280',
					borderRadius: '8px',
					backgroundColor: '#f3f4f6',
				}}
			>
				<strong>StaticChild:</strong> I have no async operations
			</div>
		)
	}
}

// Register routes
routerLike.register('static', StaticChild)
routerLike.register('async', AsyncChildDirect)

/**
 * RouterOutlet-like component that renders the matched route
 */
function Outlet(handle: Handle) {
	console.log('[Outlet] setup called')

	// Subscribe to navigation and routeUpdate events
	handle.on(routerLike, {
		navigate: () => {
			console.log('[Outlet] navigate event received, calling handle.update()')
			handle.update()
		},
		routeUpdate: () => {
			console.log(
				'[Outlet] routeUpdate event received, calling handle.update()',
			)
			handle.update()
		},
	})

	return () => {
		console.log(
			'[Outlet] render called, currentRoute:',
			routerLike.currentRoute,
		)
		const result = routerLike.match()
		if (!result) {
			return <div>404 - Not Found</div>
		}
		const { component: Component, params } = result
		return <Component params={params} />
	}
}

/**
 * App wrapper
 */
function App() {
	return () => (
		<div
			css={{
				fontFamily: 'system-ui, sans-serif',
				maxWidth: '700px',
				margin: '40px auto',
				padding: '20px',
			}}
		>
			<h1 css={{ marginBottom: '10px' }}>
				Remix VDOM Bug - Reproduction Attempt
			</h1>

			<div
				css={{
					padding: '15px',
					marginBottom: '20px',
					backgroundColor: '#dbeafe',
					borderRadius: '8px',
					border: '1px solid #93c5fd',
				}}
			>
				<strong>Note:</strong> This simplified reproduction does NOT trigger the
				bug. The bug appears in the actual router implementation where a
				workaround was needed. See{' '}
				<a
					href="https://github.com/remix-run/remix/issues/11012"
					target="_blank"
					rel="noopener noreferrer"
				>
					GitHub Issue #11012
				</a>{' '}
				for details.
			</div>

			<div css={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
				<button
					type="button"
					on={{ click: () => routerLike.navigate('static') }}
					css={{
						padding: '12px 24px',
						fontSize: '16px',
						fontWeight: 'bold',
						backgroundColor:
							routerLike.currentRoute === 'static' ? '#2563eb' : '#3b82f6',
						color: 'white',
						border: 'none',
						borderRadius: '8px',
						cursor: 'pointer',
						'&:hover': { backgroundColor: '#2563eb' },
					}}
				>
					Go to StaticChild
				</button>
				<button
					type="button"
					on={{ click: () => routerLike.navigate('async') }}
					css={{
						padding: '12px 24px',
						fontSize: '16px',
						fontWeight: 'bold',
						backgroundColor:
							routerLike.currentRoute === 'async' ? '#2563eb' : '#3b82f6',
						color: 'white',
						border: 'none',
						borderRadius: '8px',
						cursor: 'pointer',
						'&:hover': { backgroundColor: '#2563eb' },
					}}
				>
					Go to AsyncChild
				</button>
			</div>

			<div css={{ marginBottom: '20px' }}>
				<Outlet />
			</div>

			<div
				css={{
					padding: '15px',
					backgroundColor: '#f3f4f6',
					borderRadius: '8px',
					border: '1px solid #d1d5db',
				}}
			>
				<strong>Workaround in actual router:</strong>
				<pre
					css={{
						margin: '10px 0 0 0',
						padding: '10px',
						backgroundColor: '#1f2937',
						color: '#f9fafb',
						borderRadius: '4px',
						fontSize: '13px',
						overflow: 'auto',
					}}
				>
					{`// Instead of:
handle.update()

// Route components use:
router.requestRouteUpdate()

// And RouterOutlet listens for it:
handle.on(router, {
  navigate: () => handle.update(),
  routeUpdate: () => handle.update(),
})`}
				</pre>
			</div>
		</div>
	)
}

// Mount the app
const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<App />)
