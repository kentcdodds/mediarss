# Remix beta.0 release notes

## remix@3.0.0-beta.0

### Pre-release Changes

- BREAKING CHANGE: Removed the deprecated `remix/component`,
  `remix/component/jsx-runtime`, `remix/component/jsx-dev-runtime`, and
  `remix/component/server` package exports. Import the consolidated UI runtime
  from `remix/ui`, `remix/ui/jsx-runtime`, `remix/ui/jsx-dev-runtime`, and
  `remix/ui/server` instead.

  Removed `package.json` `bin` commands:
  - `remix-test`

  Added `package.json` `exports`:
  - `remix/node-fetch-server/test` to re-export APIs from
    `@remix-run/node-fetch-server/test`
  - `remix/node-serve` to re-export APIs from `@remix-run/node-serve`
  - `remix/terminal` to re-export APIs from `@remix-run/terminal`
  - `remix/test/cli` to re-export APIs from `@remix-run/test/cli`

  Added `package.json` `exports` for the consolidated UI runtime:
  - `remix/ui` to re-export APIs from `@remix-run/ui`
  - `remix/ui/jsx-runtime` to re-export APIs from `@remix-run/ui/jsx-runtime`
  - `remix/ui/jsx-dev-runtime` to re-export APIs from
    `@remix-run/ui/jsx-dev-runtime`
  - `remix/ui/server` to re-export APIs from `@remix-run/ui/server`
  - `remix/ui/animation` to re-export APIs from `@remix-run/ui/animation`
  - `remix/ui/accordion` to re-export APIs from `@remix-run/ui/accordion`
  - `remix/ui/anchor` to re-export APIs from `@remix-run/ui/anchor`
  - `remix/ui/breadcrumbs` to re-export APIs from `@remix-run/ui/breadcrumbs`
  - `remix/ui/button` to re-export APIs from `@remix-run/ui/button`
  - `remix/ui/combobox` to re-export APIs from `@remix-run/ui/combobox`
  - `remix/ui/glyph` to re-export APIs from `@remix-run/ui/glyph`
  - `remix/ui/listbox` to re-export APIs from `@remix-run/ui/listbox`
  - `remix/ui/menu` to re-export APIs from `@remix-run/ui/menu`
  - `remix/ui/popover` to re-export APIs from `@remix-run/ui/popover`
  - `remix/ui/scroll-lock` to re-export APIs from `@remix-run/ui/scroll-lock`
  - `remix/ui/select` to re-export APIs from `@remix-run/ui/select`
  - `remix/ui/separator` to re-export APIs from `@remix-run/ui/separator`
  - `remix/ui/theme` to re-export APIs from `@remix-run/ui/theme`
  - `remix/ui/test` to re-export APIs from `@remix-run/ui/test`

- Added optional peer dependency metadata for feature-specific packages exposed
  through `remix` exports, including database drivers and Playwright.

- Bumped `@remix-run/*` dependencies:
  - [`assert@0.2.0`](https://github.com/remix-run/remix/releases/tag/assert@0.2.0)
  - [`assets@0.3.0`](https://github.com/remix-run/remix/releases/tag/assets@0.3.0)
  - [`async-context-middleware@0.2.2`](https://github.com/remix-run/remix/releases/tag/async-context-middleware@0.2.2)
  - [`auth@0.2.1`](https://github.com/remix-run/remix/releases/tag/auth@0.2.1)
  - [`auth-middleware@0.1.2`](https://github.com/remix-run/remix/releases/tag/auth-middleware@0.1.2)
  - [`cli@0.2.0`](https://github.com/remix-run/remix/releases/tag/cli@0.2.0)
  - [`compression-middleware@0.1.7`](https://github.com/remix-run/remix/releases/tag/compression-middleware@0.1.7)
  - [`cop-middleware@0.1.2`](https://github.com/remix-run/remix/releases/tag/cop-middleware@0.1.2)
  - [`cors-middleware@0.1.2`](https://github.com/remix-run/remix/releases/tag/cors-middleware@0.1.2)
  - [`csrf-middleware@0.1.2`](https://github.com/remix-run/remix/releases/tag/csrf-middleware@0.1.2)
  - [`data-table@0.2.1`](https://github.com/remix-run/remix/releases/tag/data-table@0.2.1)
  - [`data-table-mysql@0.3.1`](https://github.com/remix-run/remix/releases/tag/data-table-mysql@0.3.1)
  - [`data-table-postgres@0.3.1`](https://github.com/remix-run/remix/releases/tag/data-table-postgres@0.3.1)
  - [`data-table-sqlite@0.4.1`](https://github.com/remix-run/remix/releases/tag/data-table-sqlite@0.4.1)
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)
  - [`form-data-middleware@0.2.3`](https://github.com/remix-run/remix/releases/tag/form-data-middleware@0.2.3)
  - [`logger-middleware@0.2.1`](https://github.com/remix-run/remix/releases/tag/logger-middleware@0.2.1)
  - [`method-override-middleware@0.1.7`](https://github.com/remix-run/remix/releases/tag/method-override-middleware@0.1.7)
  - [`node-fetch-server@0.13.1`](https://github.com/remix-run/remix/releases/tag/node-fetch-server@0.13.1)
  - [`node-serve@0.1.0`](https://github.com/remix-run/remix/releases/tag/node-serve@0.1.0)
  - [`session-middleware@0.2.2`](https://github.com/remix-run/remix/releases/tag/session-middleware@0.2.2)
  - [`static-middleware@0.4.8`](https://github.com/remix-run/remix/releases/tag/static-middleware@0.4.8)
  - [`test@0.3.0`](https://github.com/remix-run/remix/releases/tag/test@0.3.0)
  - [`ui@0.1.1`](https://github.com/remix-run/remix/releases/tag/ui@0.1.1)

## assert@0.2.0

### Minor Changes

- Add `expect` API alongside the existing `assert.*` functions
  - `expect(value).toBe(expected)`
    - `toBe`, `toEqual`, `toBeNull`, `toBeUndefined`, `toBeDefined`,
      `toBeTruthy`, `toBeInstanceOf`
    - Numbers: `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`,
      `toBeLessThanOrEqual`, `toBeCloseTo`
    - Strings / iterables: `toContain`, `toMatch`, `toHaveLength`
    - Object shape: `toHaveProperty`, (recursive partial equality)
    - Throwing: `toThrow`
    - Mock-aware (works with `mock.fn()` / `mock.method()` from
      `@remix-run/test`): `toHaveBeenCalled`, `toHaveBeenCalledTimes`,
      `toHaveBeenCalledWith`, `toHaveBeenNthCalledWith`
    - Partial matching: `expect(value).toMatchObject(expected)`,
      `expect(value).toEqual(expect.objectContaining(expected))`

### Patch Changes

- Add missed object support to `assert.throws` and `assert.rejects` for
  validating individual error properties (e.g.
  `{ code: 'ERR_INVALID_ARG_VALUE' }`). `RegExp` values inside the object match
  string properties; everything else uses deep equality.

## assets@0.3.0

### Minor Changes

- BREAKING CHANGE: `createAssetServer()` now requires a `basePath` option, and
  `fileMap` URL patterns are now relative to that base path.

  ```ts
  // Before:
  createAssetServer({
  	fileMap: {
  		'/assets/app/*path': 'app/*path',
  		'/assets/npm/*path': 'node_modules/*path',
  	},
  	allow: ['app/**', 'node_modules/**'],
  })

  // After:
  createAssetServer({
  	basePath: '/assets',
  	fileMap: {
  		'/app/*path': 'app/*path',
  		'/npm/*path': 'node_modules/*path',
  	},
  	allow: ['app/**', 'node_modules/**'],
  })
  ```

### Patch Changes

- The `@oxc-project/runtime` package which provides helpers for generated code
  targeting older browsers is now served automatically by the asset server and
  doesn't need to be manually installed.

## async-context-middleware@0.2.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## auth@0.2.1

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## auth-middleware@0.1.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## cli@0.2.0

### Minor Changes

- BREAKING CHANGE: Remove the `remix skills` command from the Remix CLI.

- Use `remix/node-serve` as the default server in new apps created with
  `remix new`.

### Patch Changes

- Lazy-load command implementations after CLI command dispatch so unrelated
  commands do not load optional command dependencies during startup.

- Bumped `@remix-run/*` dependencies:
  - [`test@0.3.0`](https://github.com/remix-run/remix/releases/tag/test@0.3.0)

## compression-middleware@0.1.7

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## cop-middleware@0.1.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## cors-middleware@0.1.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## csrf-middleware@0.1.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## data-table@0.2.1

### Patch Changes

- Clarify the package description to describe general JavaScript usage instead
  of Remix-specific usage.

## data-table-mysql@0.3.1

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`data-table@0.2.1`](https://github.com/remix-run/remix/releases/tag/data-table@0.2.1)

## data-table-postgres@0.3.1

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`data-table@0.2.1`](https://github.com/remix-run/remix/releases/tag/data-table@0.2.1)

## data-table-sqlite@0.4.1

### Patch Changes

- Normalized native SQLite write metadata and bind values so `node:sqlite`, Bun
  SQLite, and compatible clients consistently report affected rows and treat
  `undefined` writes as SQL `NULL`.

- Bumped `@remix-run/*` dependencies:
  - [`data-table@0.2.1`](https://github.com/remix-run/remix/releases/tag/data-table@0.2.1)

## fetch-router@0.18.2

### Patch Changes

- Fix `router.fetch()` to support `Request` facades that clone to a native
  `Request`, such as lazy server request wrappers.

## form-data-middleware@0.2.3

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## logger-middleware@0.2.1

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## method-override-middleware@0.1.7

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## node-fetch-server@0.13.1

### Patch Changes

- Improve request throughput so `node-fetch-server` is now on par with native
  `node:http` performance in the request-inspection benchmark, while preserving
  Fetch API request handlers. The main optimizations lazily materialize
  `Request` and `Headers` objects, specialize handlers by declared arity, avoid
  unnecessary client/request work on hot paths, and send single-chunk response
  bodies with less Web stream overhead. See the
  [`node-fetch-server` benchmarks](https://github.com/remix-run/remix/tree/main/packages/node-fetch-server#benchmarks)
  for current results.

## node-serve@0.1.0

### Minor Changes

- Add `node-serve`, a high-performance Node.js server package for running Fetch
  API request handlers with the `remix/node-serve` export.

## session-middleware@0.2.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## static-middleware@0.4.8

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fetch-router@0.18.2`](https://github.com/remix-run/remix/releases/tag/fetch-router@0.18.2)

## test@0.3.0

### Minor Changes

- Add `FakeTimers#advanceAsync(ms)` to `t.useFakeTimers()`. Like `advance`, it
  walks pending timers in time order and fires them, but yields to microtasks
  between each firing so promise continuations (and any timers they schedule)
  can settle before the next firing is processed. Use it when a
  fake-timer-driven callback awaits work that itself depends on the fake clock.

- Accept arrays for `glob.{test,browser,e2e,exclude}`, `project`, `type`, and
  `coverage.{include,exclude}` config fields
  - The matching CLI flags (`--glob.test`, `--project`, `--type`, etc.) can be
    repeated
  - Positional arguments after `remix-test` now collect into `glob.test`, so
    `remix-test "src/**/*.test.ts" "tests/**/*.test.tsx"` works.
  - `type`'s default is now `["server", "browser", "e2e"]` instead of
    `"server,browser,e2e"`.

- Include the total number of test files/suites in the end-of-run summary for
  all test reporters

### Patch Changes

- Load Playwright only when browser or E2E tests run, allowing test help and
  server-only test runs without Playwright installed. Browser and E2E test runs
  now report a clearer error when Playwright is missing.

- Run server and E2E test files in forked child processes by default, add
  `pool: 'threads'`/`--pool threads` to preserve the previous worker-thread
  behavior, and clean up leaked test worker resources after results are
  reported.

## ui@0.1.1

### Patch Changes

- Improved runtime rendering performance by reducing child normalization, keyed
  reconciliation, mixin lifecycle, scheduler phase, and host insertion overhead.

- Stripped `<!DOCTYPE>` markup from server and client frame responses before
  rendering frame content.
