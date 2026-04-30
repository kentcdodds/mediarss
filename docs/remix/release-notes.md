# Remix alpha.6 release notes

## remix@3.0.0-alpha.6

### Pre-release Changes

- BREAKING CHANGE: `MultipartPart.headers` from `remix/multipart-parser` and
  `remix/multipart-parser/node` is now a plain decoded object keyed by
  lower-case header name instead of a native `Headers` instance. Access part
  headers with bracket notation like `part.headers['content-type']` instead of
  `part.headers.get('content-type')`.

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

- Added `package.json` exports and binaries for the Remix CLI:
  - `remix/cli` to expose the Remix CLI programmatic API
  - `remix` as a `package.json` `bin` command that delegates to `@remix-run/cli`

  The Remix CLI now reads the current Remix version from the `remix` package and
  declares Node.js 24.3.0 or later in package metadata.

- Bumped `@remix-run/*` dependencies:
  - [`assets@0.2.0`](https://github.com/remix-run/remix/releases/tag/assets@0.2.0)
  - [`auth@0.2.0`](https://github.com/remix-run/remix/releases/tag/auth@0.2.0)
  - [`cli@0.1.0`](https://github.com/remix-run/remix/releases/tag/cli@0.1.0)
  - [`compression-middleware@0.1.6`](https://github.com/remix-run/remix/releases/tag/compression-middleware@0.1.6)
  - [`data-schema@0.3.0`](https://github.com/remix-run/remix/releases/tag/data-schema@0.3.0)
  - [`data-table-sqlite@0.4.0`](https://github.com/remix-run/remix/releases/tag/data-table-sqlite@0.4.0)
  - [`fetch-proxy@0.8.0`](https://github.com/remix-run/remix/releases/tag/fetch-proxy@0.8.0)
  - [`file-storage@0.13.4`](https://github.com/remix-run/remix/releases/tag/file-storage@0.13.4)
  - [`file-storage-s3@0.1.1`](https://github.com/remix-run/remix/releases/tag/file-storage-s3@0.1.1)
  - [`form-data-middleware@0.2.2`](https://github.com/remix-run/remix/releases/tag/form-data-middleware@0.2.2)
  - [`form-data-parser@0.17.0`](https://github.com/remix-run/remix/releases/tag/form-data-parser@0.17.0)
  - [`fs@0.4.3`](https://github.com/remix-run/remix/releases/tag/fs@0.4.3)
  - [`lazy-file@5.0.3`](https://github.com/remix-run/remix/releases/tag/lazy-file@5.0.3)
  - [`logger-middleware@0.2.0`](https://github.com/remix-run/remix/releases/tag/logger-middleware@0.2.0)
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)
  - [`multipart-parser@0.16.0`](https://github.com/remix-run/remix/releases/tag/multipart-parser@0.16.0)
  - [`response@0.3.3`](https://github.com/remix-run/remix/releases/tag/response@0.3.3)
  - [`static-middleware@0.4.7`](https://github.com/remix-run/remix/releases/tag/static-middleware@0.4.7)
  - [`tar-parser@0.7.1`](https://github.com/remix-run/remix/releases/tag/tar-parser@0.7.1)
  - [`terminal@0.1.0`](https://github.com/remix-run/remix/releases/tag/terminal@0.1.0)
  - [`test@0.2.0`](https://github.com/remix-run/remix/releases/tag/test@0.2.0)
  - [`ui@0.1.0`](https://github.com/remix-run/remix/releases/tag/ui@0.1.0)

## assets@0.2.0

### Minor Changes

- BREAKING CHANGE: `target` configuration is now configured at the top level
  with an object format, supporting `es` version targets along with browser
  version targets.

  Browser targets are configured with string versions such as
  `target: { chrome: '109', safari: '16.4' }`, and scripts can specify `es` as a
  year of `2015` or higher such as `target: { es: '2020' }`.

  To migrate existing script configuration, replace `scripts.target` options
  like `scripts: { target: 'es2020' }` with `target: { es: '2020' }`.

- BREAKING CHANGE: Shared compiler options are now provided at the top level of
  `createAssetServer()`. Use `sourceMaps`, `sourceMapSourcePaths`, and `minify`
  directly on the asset server options instead of being nested under `scripts`.
  This allows these options to also be used for styles as well as scripts.

  To migrate existing configuration, move `scripts.minify`,
  `scripts.sourceMaps`, `scripts.sourceMapSourcePaths` to the top-level asset
  server options.

- `createAssetServer()` now compiles and serves `.css` files alongside scripts,
  including local `@import` rewriting, fingerprinting, and shared compiler
  options for minification, source maps, and browser compatibility targeting.

### Patch Changes

- Fix matching of dot-prefixed files and directories in `allow` and `deny` globs

- Improve asset server import errors to include the resolved file path when a
  resolved import is later rejected by validation for allow/deny rules,
  supported file types and `fileMap` configuration.

## auth@0.2.0

### Minor Changes

- Added `createAtmosphereAuthProvider(options)` to support atproto OAuth flows
  against Atmosphere-compatible authorization servers.

  The new provider resolves handles and DIDs with
  `provider.prepare(handleOrDid)` before redirecting, performs required pushed
  authorization requests with DPoP, supports both public web clients and
  localhost loopback development clients, and seals per-session DPoP state into
  the in-flight OAuth transaction using the required `sessionSecret` option
  instead of a separate persistent store.

  Create the Atmosphere provider once with shared options, call
  `provider.prepare(handleOrDid)` only before `startExternalAuth()`, and pass
  the module-scope provider directly to `finishExternalAuth()` and
  `refreshExternalAuth()`. Atmosphere callback results preserve the DPoP binding
  state and authorization server refresh details alongside the returned
  `accessToken` and `refreshToken`, so callers can reuse the completed token
  bundle directly for refresh-token exchange and follow-up DPoP-signed requests.

- Added `refreshExternalAuth()` to `@remix-run/auth` so apps can exchange stored
  refresh tokens for fresh OAuth and OIDC token bundles.

  The built-in OIDC providers, X, and Atmosphere now implement refresh-token
  exchange. Refreshed token bundles preserve the existing refresh token when the
  provider omits a rotated value.

## cli@0.1.0

### Minor Changes

- Initial release of `@remix-run/cli` with the public `runRemix()` API and
  commands for project scaffolding, health checks and fixes, route inspection,
  skills syncing, and running tests. The package requires Node.js 24.3.0 or
  later and exposes the programmatic CLI API; use the `remix` package for the
  user-facing `remix` executable.

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`tar-parser@0.7.1`](https://github.com/remix-run/remix/releases/tag/tar-parser@0.7.1)
  - [`terminal@0.1.0`](https://github.com/remix-run/remix/releases/tag/terminal@0.1.0)
  - [`test@0.2.0`](https://github.com/remix-run/remix/releases/tag/test@0.2.0)

## compression-middleware@0.1.6

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)
  - [`response@0.3.3`](https://github.com/remix-run/remix/releases/tag/response@0.3.3)

## data-schema@0.3.0

### Minor Changes

- Add `Schema.transform()` for mapping validated schema outputs to new values
  and output types.

## data-table-sqlite@0.4.0

### Minor Changes

- Widened `createSqliteDatabaseAdapter` to accept synchronous SQLite clients
  that match the shared `prepare`/`exec` surface used by Node's `node:sqlite`,
  Bun's `bun:sqlite`, and compatible clients. The package no longer requires
  `better-sqlite3` as an optional peer dependency.

## fetch-proxy@0.8.0

### Minor Changes

- Add an `X-Forwarded-Port` header when `xForwardedHeaders` is enabled.

## file-storage@0.13.4

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fs@0.4.3`](https://github.com/remix-run/remix/releases/tag/fs@0.4.3)
  - [`lazy-file@5.0.3`](https://github.com/remix-run/remix/releases/tag/lazy-file@5.0.3)

## file-storage-s3@0.1.1

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`file-storage@0.13.4`](https://github.com/remix-run/remix/releases/tag/file-storage@0.13.4)

## form-data-middleware@0.2.2

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`form-data-parser@0.17.0`](https://github.com/remix-run/remix/releases/tag/form-data-parser@0.17.0)

## form-data-parser@0.17.0

### Minor Changes

- BREAKING CHANGE: Errors thrown or rejected by a `parseFormData()` upload
  handler now propagate directly instead of being wrapped in a
  `FormDataParseError`.

### Patch Changes

- Preserve non-ASCII multipart field names and filenames when parsing
  `multipart/form-data` requests.

- Bumped `@remix-run/*` dependencies:
  - [`multipart-parser@0.16.0`](https://github.com/remix-run/remix/releases/tag/multipart-parser@0.16.0)

## fs@0.4.3

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`lazy-file@5.0.3`](https://github.com/remix-run/remix/releases/tag/lazy-file@5.0.3)
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)

## lazy-file@5.0.3

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)

## logger-middleware@0.2.0

### Minor Changes

- Colorize high-signal logger tokens when terminal color detection allows it by
  default, with a `colors` option to force colorized output on or off and
  support for `CI`, `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`, and TTY output
  streams when the `process` global is defined.

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`terminal@0.1.0`](https://github.com/remix-run/remix/releases/tag/terminal@0.1.0)

## mime@0.4.1

### Patch Changes

- Prefer `video/mp4` for `.mp4` files and `image/x-icon` for `.ico` files.

## multipart-parser@0.16.0

### Minor Changes

- BREAKING CHANGE: `MultipartPart.headers` is now a plain decoded object keyed
  by lower-case header name instead of a native `Headers` instance. Access part
  headers with bracket notation like `part.headers['content-type']` instead of
  `part.headers.get('content-type')`.

  This lets multipart part headers preserve decoded UTF-8 field names and
  filenames that native `Headers` cannot store.

## response@0.3.3

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)

## static-middleware@0.4.7

### Patch Changes

- Bumped `@remix-run/*` dependencies:
  - [`fs@0.4.3`](https://github.com/remix-run/remix/releases/tag/fs@0.4.3)
  - [`mime@0.4.1`](https://github.com/remix-run/remix/releases/tag/mime@0.4.1)
  - [`response@0.3.3`](https://github.com/remix-run/remix/releases/tag/response@0.3.3)

## tar-parser@0.7.1

### Patch Changes

- Fix parsing tar entries whose file body ends exactly at a chunk boundary.

## terminal@0.1.0

### Minor Changes

- Initial release of terminal output utilities for ANSI styles, color capability
  detection, escape sequences, and testable terminal streams. Automatic color
  detection disables styles for CI, `NO_COLOR`, `TERM=dumb`, and non-TTY output
  streams by default, and can be overridden with the `colors` option. Style
  helpers include common modifiers, foreground colors, background colors, bright
  variants, and preserve outer styles when nested formatted strings close inner
  styles.

## test@0.2.0

### Minor Changes

- Add `glob.exclude` config for filtering paths during test discovery (defaults
  to `node_modules/**`)

- Add code coverage reporting to `remix-test`
  - You can enable coverage with default settings vis `remix-test --coverage` or
    setting `coverage:true` in your `remix-test.config.ts`
  - Or you can specify individual coverage settings via the following config
    fields:
    - `coverage.dir`: Directory to store coverage information (default
      `.coverage`)
    - `coverage.include`: Array of globs for files to include in coverage
    - `coverage.exclude`: Array of globs for files to exclude from coverage
    - `coverage.statements`: Percentage threshold for statement coverage
    - `coverage.lines`: Percentage threshold for line coverage
    - `coverage.branches`: Percentage threshold for branch coverage
    - `coverage.functions`: Percentage threshold for function coverage

- Export `runRemixTest` from `@remix-run/test/cli` so other tools can run the
  Remix test runner programmatically without exiting the host process. The
  function returns an exit code so callers can decide how to terminate. The
  `remix-test` executable now declares Node.js 24.3.0 or later in package
  metadata.

### Patch Changes

- Internal refactor to test discovery to better support test execution in `bun`.
  - Unlike Node, Bun's `fs.promises.glob` _follows_ symbolic links and does not
    prune traversal via the `exclude` option, which can cause the test runner to
    enter `node_modules` symlink cycles in pnpm workspaces
  - Refactored the internal test discovery logic to detect and use Bun's native
    `Glob` class when running under the Bun runtime. Bun's `Glob#scan` does not
    follow symlinks by default, avoiding the cycle.
  - The Node runtime continues to use `fs.promises.glob`

- Use native dynamic `import()` in Bun to load `.ts` and `.tsx` files in the
  test runner

- Bumped `@remix-run/*` dependencies:
  - [`terminal@0.1.0`](https://github.com/remix-run/remix/releases/tag/terminal@0.1.0)

## ui@0.1.0

### Minor Changes

- BREAKING CHANGE: Consolidated the deprecated `@remix-run/component` package
  into `@remix-run/ui`. Import component runtime APIs from `@remix-run/ui`,
  server rendering APIs from `@remix-run/ui/server`, JSX runtime APIs from
  `@remix-run/ui/jsx-runtime` and `@remix-run/ui/jsx-dev-runtime`, and animation
  APIs from `@remix-run/ui/animation`.

  Removed the deprecated `@remix-run/ui/on-outside-pointer-down` export. Use the
  popover, menu, or other component-level outside interaction APIs instead.

- BREAKING CHANGE: Components now receive props through a stable `handle.props`
  object using `Handle<Props, Context>` instead of receiving a separate `setup`
  argument and render callback props. Move initialization values that previously
  used `<Component setup={...} />` onto regular props, and read all props from
  `handle.props` in both the component function and render callback.

  Before:

  ```tsx
  function Counter(
  	handle: Handle<CounterContext>,
  	setup: { initialCount: number },
  ) {
  	let count = setup.initialCount

  	return (props: { label: string }) => (
  		<button>
  			{props.label}: {count}
  		</button>
  	)
  }

  ;<Counter setup={{ initialCount: 10 }} label="Count" />
  ```

  After:

  ```tsx
  function Counter(
  	handle: Handle<{ initialCount: number; label: string }, CounterContext>,
  ) {
  	let count = handle.props.initialCount

  	return () => (
  		<button>
  			{handle.props.label}: {count}
  		</button>
  	)
  }

  ;<Counter initialCount={10} label="Count" />
  ```

  The `handle.props` object keeps the same identity for the component lifetime
  while its values are updated before each render, so destructuring
  `let { props, update } = handle` remains safe. The `setup` prop is no longer
  special and is treated like any other prop.

  This also removes the old pattern where setup-scope helpers had to read from a
  mutable variable that was reassigned inside the render callback:

  ```tsx
  function Listbox(handle: Handle<ListboxContext>) {
  	let props: ListboxProps

  	function select(value: string) {
  		props.onSelect(value)
  	}

  	handle.context.set({ select })

  	return (nextProps: ListboxProps) => {
  		props = nextProps
  		return props.children
  	}
  }
  ```

  Helpers can now read the current props directly from the stable handle:

  ```tsx
  function Listbox(handle: Handle<ListboxProps, ListboxContext>) {
  	function select(value: string) {
  		handle.props.onSelect(value)
  	}

  	handle.context.set({ select })

  	return () => handle.props.children
  }
  ```

- BREAKING CHANGE: Removed the deprecated `keysEvents`, `pressEvents`, and
  `PressEvent` exports from `@remix-run/ui`. Use `on(...)` with native DOM
  keyboard, pointer, and click events directly instead.
