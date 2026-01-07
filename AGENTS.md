Default to using Bun instead of Node.js.

## Linting

Always run `bun run lint` before you're done working to fix any lint issues.

## Formatting

Always run `bun run format` before you're done working to fix any formatting issues.

## No React

This application does NOT use React. We use `@remix-run/component` for UI components. Do not introduce React, Preact, or any other UI framework.

### Remix Components vs React Components

Remix components work differently from React. Here's how:

#### Stateless Components

For simple components with no state, just return JSX directly:

```tsx
function Greeting({ name }: { name: string }) {
	return <div>Hello, {name}!</div>
}
```

#### Stateful Components

For components that need state, use `this: Handle` and **return a function** that returns JSX. The closure above the return acts as your state container:

```tsx
import type { Handle } from '@remix-run/component'

function Counter(this: Handle) {
	// State lives in the closure
	let count = 0

	// Call this.update() to re-render when state changes
	const increment = () => {
		count++
		this.update()
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

When a component has both props and state, use **setupProps** for initial setup and **renderProps** for rendering:

> **⚠️ Important:** Always use `renderProps` inside the render function to get the latest prop values. The `setupProps` are captured once at setup time and may be stale.

```tsx
import type { Handle } from '@remix-run/component'

function UserCard(
	this: Handle,
	setupProps: { userId: string } // Captured once at setup
) {
	let user: User | null = null
	let loading = true

	// Use setupProps for initial data fetching
	fetch(`/api/users/${setupProps.userId}`)
		.then(res => res.json())
		.then(data => {
			user = data
			loading = false
			this.update()
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

Use `this.on()` to subscribe to custom events or other event targets:

```tsx
function RouterAware(this: Handle) {
	this.on(router, { navigate: () => this.update() })
	
	return () => <div>Current path: {location.pathname}</div>
}
```

#### Abort Signal

Use `this.signal` for cancellable async operations:

```tsx
function DataLoader(this: Handle) {
	let data = null

	fetch('/api/data', { signal: this.signal })
		.then(res => res.json())
		.then(d => {
			data = d
			this.update()
		})
		.catch(err => {
			if (this.signal.aborted) return // Component unmounted
			console.error(err)
		})

	return () => <div>{data ? JSON.stringify(data) : 'Loading...'}</div>
}
```

#### The `connect` Prop (No refs!)

Remix components do **NOT** support React-style refs. Instead, use the `connect` prop to detect when an element has been added to the screen and get a reference to the DOM node.

```tsx
function MyComponent() {
	return (
		<div connect={(node, signal) => {
			// This runs when the element is added to the DOM
			console.log('Element added to screen:', node)
			
			// The signal is aborted when the element is removed
			signal.addEventListener('abort', () => {
				console.log('Element removed from screen')
			})
		}}>
			Hello World
		</div>
	)
}
```

**Key features:**

- **Automatic cleanup**: The `AbortSignal` is automatically aborted when the element is removed from the DOM
- **Flexible signature**: You can use either `(node)` or `(node, signal)` depending on whether you need cleanup logic
- **Scheduled execution**: The callback runs after the element is inserted into the DOM

**Example with DOM manipulation:**

```tsx
function AutoFocusInput(this: Handle) {
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
function ResizeAware(this: Handle) {
	let width = 0

	return () => (
		<div connect={(node: HTMLDivElement, signal) => {
			const observer = new ResizeObserver((entries) => {
				width = entries[0].contentRect.width
				this.update()
			})
			observer.observe(node)
			
			signal.addEventListener('abort', () => {
				observer.disconnect()
			})
		}}>
			Width: {width}px
		</div>
	)
}
```

#### Context System

The context system allows indirect ancestor/descendant communication without passing props through every level. It's accessed via `this.context` on the `Handle` interface.

**Setting Context (Provider):**

A parent component provides context using `this.context.set()`. The context type is declared as a generic parameter on `Handle`:

```tsx
import type { Handle } from '@remix-run/component'

function ThemeProvider(this: Handle<{ theme: 'light' | 'dark' }>) {
	// Set context value for all descendants
	this.context.set({ theme: 'dark' })
	
	return () => (
		<div>
			<ThemedButton />
			<ThemedText />
		</div>
	)
}
```

**Getting Context (Consumer):**

Descendant components retrieve context using `this.context.get()`, passing the provider component as the key:

```tsx
import type { Handle } from '@remix-run/component'

function ThemedButton(this: Handle) {
	// Get context from nearest ancestor ThemeProvider
	const theme = this.context.get(ThemeProvider)
	
	return () => (
		<button css={{ 
			background: theme?.theme === 'dark' ? '#333' : '#fff',
			color: theme?.theme === 'dark' ? '#fff' : '#333'
		}}>
			Click me
		</button>
	)
}
```

**Key Features:**

- **Type Safety**: Context is fully typed via TypeScript generics - `Handle<{ theme: string }>` defines the context shape
- **Ancestor Lookup**: Automatically traverses up the component tree to find the nearest ancestor that provides the requested context
- **Scoped**: Each component instance can provide its own context, allowing nested providers with different values
- **Component-keyed**: Use the provider component function itself as the lookup key

**Full Example with Multiple Consumers:**

```tsx
import type { Handle } from '@remix-run/component'

// Provider component with typed context
function UserProvider(this: Handle<{ user: { name: string; role: string } }>) {
	this.context.set({ user: { name: 'Alice', role: 'admin' } })
	
	return () => (
		<div>
			<UserGreeting />
			<UserBadge />
		</div>
	)
}

// Consumer component 1
function UserGreeting(this: Handle) {
	const ctx = this.context.get(UserProvider)
	
	return () => <h1>Welcome, {ctx?.user.name}!</h1>
}

// Consumer component 2
function UserBadge(this: Handle) {
	const ctx = this.context.get(UserProvider)
	
	return () => (
		<span css={{
			padding: '4px 8px',
			background: ctx?.user.role === 'admin' ? '#ef4444' : '#3b82f6',
			borderRadius: '4px',
			color: 'white'
		}}>
			{ctx?.user.role}
		</span>
	)
}
```

#### Known Bug: DOM insertBefore Error

There's a known bug in Remix components where navigating with the client-side router can sometimes cause this console error:

```
Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.
```

**Workaround:** If you see this error while testing, simply refresh the page. This is a framework-level issue that doesn't indicate a problem with your code.

## Bun

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Build

There is no build step. This is shipped as-is. Instead, we use Bun's built-in runtime typescript support and we do a runtime bundling of the client-side code in `server/bundling.ts`.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
	expect(1).toBe(1);
});
```

### Manual Testing with Local Media

To test the application with sample media files, use the `local-test` directory:

```bash
bun run dev:test
```

This command:
- Sets `DATABASE_PATH=./data/test.db` (separate from production data)
- Sets `MEDIA_PATHS=audio:./local-test/1/audio,video:./local-test/1/video`
- Runs the dev server with watch mode

**Important:** Each media path name must be unique. Duplicate names are not allowed and will cause a validation error at startup.

The `local-test/1` directory contains sample media files:
- `audio/` - Audiobook files (.m4b, .m4a, .mp3)
- `video/` - Video files (.mkv)

You can add your own test media files to `local-test/` - this directory is gitignored.

## Frontend

We limit the number of frontend dependencies to the bare minimum. Each
`node_modules` package needs to be explicitly listed in the import map in the
`layout.tsx` file.
