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
