/**
 * MINIMAL reproduction of Remix VDOM bug.
 *
 * BUG: handle.update() doesn't update DOM when render returns a child component.
 *
 * KEY FINDING: The bug ONLY occurs when the render function returns a
 * COMPONENT (like <Loading />) instead of plain JSX (like <div>Loading</div>).
 *
 * See: https://github.com/remix-run/remix/issues/11012
 */

import { createRoot, type Handle } from 'remix/component'
import { TypedEventTarget } from 'remix/interaction'

// Minimal router
class Router extends TypedEventTarget<{ navigate: Event }> {
	path = '/a'
	routes = new Map<string, (h: Handle) => () => JSX.Element>()
	navigate(p: string) {
		if (p !== this.path) {
			this.path = p
			this.dispatchEvent(new Event('navigate'))
		}
	}
}
const router = new Router()

// Outlet
function Outlet(handle: Handle) {
	handle.on(router, { navigate: () => handle.update() })
	return () => {
		const Page = router.routes.get(router.path)
		return Page ? <Page /> : <div>404</div>
	}
}

// ⚠️ This separate component TRIGGERS the bug
function Loading() {
	return () => <div>Loading...</div>
}

// Page A
function PageA() {
	return () => (
		<div>
			<h1>Page A</h1>
			<button type="button" on={{ click: () => router.navigate('/b') }}>
				Go to B
			</button>
		</div>
	)
}

// Page B - BUG MANIFESTS HERE
function PageB(handle: Handle) {
	let loaded = false

	setTimeout(() => {
		loaded = true
		console.log('calling handle.update()')
		handle.update()
		console.log('handle.update() returned')
	}, 100)

	return () => {
		console.log('PageB render, loaded:', loaded)

		// ⚠️ BUG: Returning a component prevents DOM update
		if (!loaded) return <Loading />

		// ✅ WORKS: Returning plain JSX updates correctly
		// if (!loaded) return <div>Loading...</div>

		return <div>Loaded!</div>
	}
}

router.routes.set('/a', PageA)
router.routes.set('/b', PageB)

// App
function App() {
	return () => (
		<div>
			<nav>
				<button type="button" on={{ click: () => router.navigate('/a') }}>
					A
				</button>
				<button type="button" on={{ click: () => router.navigate('/b') }}>
					B
				</button>
			</nav>
			<Outlet />
		</div>
	)
}

createRoot(document.getElementById('root') ?? document.body).render(<App />)
