Default to using Node.js and npm.

## Linting

Always run `npm run lint` before you're done working to fix any lint issues.

## Formatting

Always run `npm run format` before you're done working to fix any formatting
issues.

## Commit Gate

Always run the full gate before committing:

`npm run validate`

Do not commit if any part of the gate fails.

## Remix Documentation

Reference `docs/remix/README.md` for mirrored package docs and package-specific
deep dives. Prefer those docs before guessing Remix APIs.

## No React

This application does NOT use React. We use `remix/ui` for UI components. Do not
introduce React, Preact, or any other UI framework.

### Remix UI Components vs React Components

Remix components work differently from React. Here's how:

#### Stateless Components

For simple components with no state, return a render function:

```tsx
function Greeting() {
	return ({ name }: { name: string }) => <div>Hello, {name}!</div>
}
```

#### Stateful Components

For components that need state, use `handle: Handle` and **return a function**
that returns JSX. The closure above the return acts as your state container:

```tsx
import type { Handle } from 'remix/ui'

function Counter(handle: Handle) {
	// State lives in the closure
	let count = 0

	// Call handle.update() to re-render when state changes
	const increment = () => {
		count++
		handle.update()
	}

	// Return a render function
	return () => (
		<div>
			<span>Count: {count}</span>
			<button on={{ click: increment }}>+</button>
		</div>
	)
}
```

#### Components with Props and State

When a component has both props and state, use **setupProps** for initial setup
and **renderProps** for rendering:

> **⚠️ Important:** Always use `renderProps` inside the render function to get
> the latest prop values. The `setupProps` are captured once at setup time and
> may be stale.

```tsx
import type { Handle } from 'remix/ui'

function UserCard(
	handle: Handle,
	setupProps: { userId: string }, // Captured once at setup
) {
	let user: User | null = null
	let loading = true

	// Use setupProps for initial data fetching
	fetch(`/api/users/${setupProps.userId}`)
		.then((res) => res.json())
		.then((data) => {
			user = data
			loading = false
			handle.update()
		})

	// renderProps always has the latest values
	return (renderProps: { userId: string }) => (
		<div>
			<h2>User: {renderProps.userId}</h2>
			{loading ? <span>Loading...</span> : <span>{user?.name}</span>}
		</div>
	)
}
```

#### Event Handling

Use `on={{ eventName: handler }}` instead of `onClick`:

```tsx
<button on={{ click: handleClick }}>Click me</button>
<input on={{ input: handleInput, blur: handleBlur }} />
```

#### CSS-in-JS

Use the `css` prop for inline styles with pseudo-selector support:

```tsx
<button
	css={{
		padding: '8px 16px',
		backgroundColor: '#3b82f6',
		'&:hover': {
			backgroundColor: '#2563eb',
		},
	}}
>
	Styled Button
</button>
```

#### Subscribing to Events

Use `handle.on()` to subscribe to custom events or other event targets:

```tsx
function RouterAware(handle: Handle) {
	handle.on(router, { navigate: () => handle.update() })

	return () => <div>Current path: {location.pathname}</div>
}
```

#### Abort Signal

Use `handle.signal` for cancellable async operations:

```tsx
function DataLoader(handle: Handle) {
	let data = null

	fetch('/api/data', { signal: handle.signal })
		.then((res) => res.json())
		.then((d) => {
			data = d
			handle.update()
		})
		.catch((err) => {
			if (handle.signal.aborted) return // Component unmounted
			console.error(err)
		})

	return () => <div>{data ? JSON.stringify(data) : 'Loading...'}</div>
}
```

#### The `connect` Prop (No refs!)

Remix components do **NOT** support React-style refs. Instead, use the `connect`
prop to detect when an element has been added to the screen and get a reference
to the DOM node.

```tsx
function MyComponent() {
	return (
		<div
			connect={(node, signal) => {
				// This runs when the element is added to the DOM
				console.log('Element added to screen:', node)

				// The signal is aborted when the element is removed
				signal.addEventListener('abort', () => {
					console.log('Element removed from screen')
				})
			}}
		>
			Hello World
		</div>
	)
}
```

**Key features:**

- **Automatic cleanup**: The `AbortSignal` is automatically aborted when the
  element is removed from the DOM
- **Flexible signature**: You can use either `(node)` or `(node, signal)`
  depending on whether you need cleanup logic
- **Scheduled execution**: The callback runs after the element is inserted into
  the DOM

**Example with DOM manipulation:**

```tsx
function AutoFocusInput(handle: Handle) {
	return () => (
		<input
			type="text"
			connect={(input: HTMLInputElement) => {
				input.focus()
			}}
		/>
	)
}
```

**Example with cleanup:**

```tsx
function ResizeAware(handle: Handle) {
	let width = 0

	return () => (
		<div
			connect={(node: HTMLDivElement, signal) => {
				const observer = new ResizeObserver((entries) => {
					width = entries[0].contentRect.width
					handle.update()
				})
				observer.observe(node)

				signal.addEventListener('abort', () => {
					observer.disconnect()
				})
			}}
		>
			Width: {width}px
		</div>
	)
}
```

#### Context System

The context system allows indirect ancestor/descendant communication without
passing props through every level. It's accessed via `handle.context` on the
`Handle` interface.

**Setting Context (Provider):**

A parent component provides context using `handle.context.set()`. The context
type is declared as a generic parameter on `Handle`:

```tsx
import type { Handle } from 'remix/ui'

function ThemeProvider(handle: Handle<{ theme: 'light' | 'dark' }>) {
	// Set context value for all descendants
	handle.context.set({ theme: 'dark' })

	return () => (
		<div>
			<ThemedButton />
			<ThemedText />
		</div>
	)
}
```

**Getting Context (Consumer):**

Descendant components retrieve context using `handle.context.get()`, passing the
provider component as the key:

```tsx
import type { Handle } from 'remix/ui'

function ThemedButton(handle: Handle) {
	// Get context from nearest ancestor ThemeProvider
	const theme = handle.context.get(ThemeProvider)

	return () => (
		<button
			css={{
				background: theme?.theme === 'dark' ? '#333' : '#fff',
				color: theme?.theme === 'dark' ? '#fff' : '#333',
			}}
		>
			Click me
		</button>
	)
}
```

**Key Features:**

- **Type Safety**: Context is fully typed via TypeScript generics -
  `Handle<{ theme: string }>` defines the context shape
- **Ancestor Lookup**: Automatically traverses up the component tree to find the
  nearest ancestor that provides the requested context
- **Scoped**: Each component instance can provide its own context, allowing
  nested providers with different values
- **Component-keyed**: Use the provider component function itself as the lookup
  key

**Full Example with Multiple Consumers:**

```tsx
import type { Handle } from 'remix/ui'

// Provider component with typed context
function UserProvider(
	handle: Handle<{ user: { name: string; role: string } }>,
) {
	handle.context.set({ user: { name: 'Alice', role: 'admin' } })

	return () => (
		<div>
			<UserGreeting />
			<UserBadge />
		</div>
	)
}

// Consumer component 1
function UserGreeting(handle: Handle) {
	const ctx = handle.context.get(UserProvider)

	return () => <h1>Welcome, {ctx?.user.name}!</h1>
}

// Consumer component 2
function UserBadge(handle: Handle) {
	const ctx = handle.context.get(UserProvider)

	return () => (
		<span
			css={{
				padding: '4px 8px',
				background: ctx?.user.role === 'admin' ? '#ef4444' : '#3b82f6',
				borderRadius: '4px',
				color: 'white',
			}}
		>
			{ctx?.user.role}
		</span>
	)
}
```

#### Router Stability Note

The historical client-router `insertBefore` instability that required manual
refreshes should be treated as fixed for this project after upgrading to
`remix@3.0.0-beta.0`.

If navigation regressions appear, debug the app code first (Link handling, route
registration, and state updates) before assuming a framework bug.

## Node.js

- Use `node` for runtime execution and `npm` for package management.
- Use `npm install` to add dependencies and update `package-lock.json`.
- Use `npm run <script>` for project scripts.
- Use `process.env` for environment variables.

## Build

There is no build step. This is shipped as-is. We use modern Node.js runtime
TypeScript support for `.ts` files, a small Node hook for `.tsx` loading, and
runtime bundling of the client-side code in `server/bundling.ts`.

## APIs

- Use the Node HTTP stack plus `remix/node-fetch-server` for the server
  entrypoint.
- Use `node:sqlite` for SQLite.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer Node's built-in `fs`, `fs/promises`, and web `File`/`Blob` APIs for
  file access.

## Testing

Use `npm test` to run tests.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
	expect(1).toBe(1);
});
```

### Manual Testing with Local Media

To test the application with sample media files, use the `local-test` directory:

```bash
npm run dev:test
```

This command:

- Sets `DATABASE_PATH=./data/test.db` (separate from production data)
- Sets `MEDIA_PATHS=audio:./local-test/1/audio,video:./local-test/1/video`
- Runs the dev server with watch mode

**Important:** Each media path name must be unique. Duplicate names are not
allowed and will cause a validation error at startup.

The `local-test/1` directory contains sample media files:

- `audio/` - Audiobook files (.m4b, .m4a, .mp3)
- `video/` - Video files (.mkv)

You can add your own test media files to `local-test/` - this directory is
gitignored.

## Frontend

We limit the number of frontend dependencies to the bare minimum. Each
`node_modules` package needs to be explicitly listed in the import map in the
`layout.tsx` file.
