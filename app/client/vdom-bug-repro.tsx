/**
 * Minimal reproduction of Remix VDOM bug.
 *
 * BUG: When a route component is created during RouterOutlet's re-render,
 * handle.update() calls from that component don't update the DOM.
 *
 * The bug ONLY manifests when using handle.update() directly.
 * The workaround is to use router.requestRouteUpdate() instead.
 *
 * See: https://github.com/remix-run/remix/issues/11012
 */

import { createRoot, type Handle } from 'remix/component'
import { TypedEventTarget } from 'remix/interaction'

// =============================================================================
// Router Implementation (mirrors app/client/admin/router.tsx)
// =============================================================================

type RouteComponent = (
	handle: Handle,
) => (props: { params: Record<string, string> }) => JSX.Element

type Route = {
	pattern: RegExp
	component: RouteComponent
}

class RouterState extends TypedEventTarget<{
	navigate: Event
	routeUpdate: Event
}> {
	#routes: Route[] = []
	#currentPath: string = '/page-a'

	get currentPath() {
		return this.#currentPath
	}

	register(pattern: string, component: RouteComponent) {
		this.#routes.push({
			pattern: new RegExp(`^${pattern}$`),
			component,
		})
	}

	navigate(path: string) {
		if (path === this.#currentPath) return
		this.#currentPath = path
		console.log('[Router] navigate to:', path)
		this.dispatchEvent(new Event('navigate'))
	}

	match(): { component: RouteComponent } | null {
		for (const route of this.#routes) {
			if (route.pattern.test(this.#currentPath)) {
				return { component: route.component }
			}
		}
		return null
	}

	requestRouteUpdate() {
		this.dispatchEvent(new Event('routeUpdate'))
	}
}

const router = new RouterState()

// =============================================================================
// Link Component (mirrors app/client/admin/router.tsx Link)
// =============================================================================

function Link() {
	return (props: { href: string; children?: JSX.Element | string }) => {
		const { href, children } = props
		return (
			<a
				href={href}
				css={{
					color: '#3b82f6',
					textDecoration: 'none',
					'&:hover': { textDecoration: 'underline' },
				}}
				on={{
					click: (e: MouseEvent) => {
						e.preventDefault()
						router.navigate(href)
					},
				}}
			>
				{children}
			</a>
		)
	}
}

// =============================================================================
// RouterOutlet Component (mirrors app/client/admin/router.tsx RouterOutlet)
// =============================================================================

function RouterOutlet(handle: Handle) {
	console.log('[RouterOutlet] setup')

	handle.on(router, {
		navigate: () => {
			console.log('[RouterOutlet] navigate event, calling handle.update()')
			handle.update()
		},
		routeUpdate: () => {
			console.log('[RouterOutlet] routeUpdate event, calling handle.update()')
			handle.update()
		},
	})

	return () => {
		console.log('[RouterOutlet] render, path:', router.currentPath)
		const result = router.match()
		if (!result) return <div>404</div>
		const Component = result.component
		return <Component params={{}} />
	}
}

// =============================================================================
// LoadingSpinner Component (separate component, not inline)
// =============================================================================

function LoadingSpinner() {
	return () => (
		<div
			css={{
				display: 'flex',
				justifyContent: 'center',
				padding: '40px',
			}}
		>
			<div
				css={{
					width: '40px',
					height: '40px',
					border: '3px solid #e5e7eb',
					borderTopColor: '#3b82f6',
					borderRadius: '50%',
					animation: 'spin 1s linear infinite',
					'@keyframes spin': { to: { transform: 'rotate(360deg)' } },
				}}
			/>
		</div>
	)
}

// =============================================================================
// PageA - Simple static page (like FeedList)
// =============================================================================

function PageA() {
	console.log('[PageA] setup')
	return () => {
		console.log('[PageA] render')
		return (
			<div>
				<h2 css={{ margin: '0 0 16px 0' }}>Page A</h2>
				<p>This is a simple static page.</p>
				<p css={{ marginTop: '16px' }}>
					<Link href="/page-b">Go to Page B →</Link>
				</p>
			</div>
		)
	}
}

// =============================================================================
// PageB - Async page that fetches data (like MediaList)
// THIS IS WHERE THE BUG MANIFESTS
// =============================================================================

function PageB(handle: Handle) {
	console.log('[PageB] setup')

	let state: { status: 'loading' } | { status: 'loaded'; data: string } = {
		status: 'loading',
	}

	// Simulate fetch (use actual fetch to match real-world scenario)
	fetch('/admin/api/version', { signal: handle.signal })
		.then((res) => res.json())
		.then((data) => {
			state = { status: 'loaded', data: JSON.stringify(data) }
			console.log('[PageB] fetch complete, state:', state.status)

			// ⚠️ BUG: This handle.update() call does NOT update the DOM
			// when PageB is created during RouterOutlet's re-render
			console.log('[PageB] calling handle.update()')
			handle.update()
			console.log('[PageB] handle.update() returned')

			// ✅ WORKAROUND: Use this instead:
			// router.requestRouteUpdate()
		})
		.catch((err) => {
			if (handle.signal.aborted) return
			console.error('[PageB] fetch error:', err)
		})

	return () => {
		console.log('[PageB] render, state:', state.status)

		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		return (
			<div>
				<h2 css={{ margin: '0 0 16px 0' }}>Page B</h2>
				<p
					css={{
						padding: '16px',
						backgroundColor: '#d1fae5',
						borderRadius: '8px',
						border: '1px solid #6ee7b7',
					}}
				>
					✅ Data loaded: {state.data}
				</p>
				<p css={{ marginTop: '16px' }}>
					<Link href="/page-a">← Back to Page A</Link>
				</p>
			</div>
		)
	}
}

// Register routes
router.register('/page-a', PageA)
router.register('/page-b', PageB)

// =============================================================================
// App Component (mirrors app/client/admin/entry.tsx AdminApp)
// =============================================================================

function App() {
	return () => (
		<div
			css={{
				fontFamily: 'system-ui, sans-serif',
				minHeight: '100vh',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			{/* Header */}
			<header
				css={{
					borderBottom: '1px solid #e5e7eb',
					padding: '16px 24px',
					display: 'flex',
					alignItems: 'center',
					gap: '16px',
				}}
			>
				<h1 css={{ margin: 0, fontSize: '18px' }}>VDOM Bug Reproduction</h1>
				<nav css={{ display: 'flex', gap: '16px' }}>
					<Link href="/page-a">Page A</Link>
					<Link href="/page-b">Page B</Link>
				</nav>
			</header>

			{/* Main Content */}
			<main
				css={{
					flex: 1,
					maxWidth: '800px',
					width: '100%',
					margin: '0 auto',
					padding: '24px',
				}}
			>
				<RouterOutlet />
			</main>

			{/* Instructions */}
			<div
				css={{
					maxWidth: '800px',
					width: '100%',
					margin: '0 auto',
					padding: '0 24px 24px',
				}}
			>
				<div
					css={{
						padding: '16px',
						backgroundColor: '#fef2f2',
						borderRadius: '8px',
						border: '1px solid #fecaca',
						fontSize: '14px',
					}}
				>
					<strong>How to reproduce the bug:</strong>
					<ol css={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
						<li>Open the browser console (F12)</li>
						<li>Click "Page B" in the navigation</li>
						<li>
							Observe: Page B stays stuck on loading spinner even though console
							shows <code>handle.update()</code> was called
						</li>
					</ol>
					<p css={{ margin: '12px 0 0 0', color: '#dc2626' }}>
						<strong>Expected:</strong> Page should show "Data loaded" after
						fetch completes
						<br />
						<strong>Actual:</strong> Page stays on loading spinner
					</p>
				</div>
			</div>

			{/* Footer */}
			<footer
				css={{
					borderTop: '1px solid #e5e7eb',
					padding: '16px 24px',
					textAlign: 'center',
					color: '#6b7280',
					fontSize: '14px',
				}}
			>
				See{' '}
				<a
					href="https://github.com/remix-run/remix/issues/11012"
					target="_blank"
					rel="noopener noreferrer"
				>
					GitHub Issue #11012
				</a>
			</footer>
		</div>
	)
}

// Mount the app
const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<App />)
