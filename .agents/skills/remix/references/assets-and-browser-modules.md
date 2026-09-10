# Assets and Browser Modules

## What This Covers

How to serve browser scripts and styles from source. Read this when the task
involves:

- Configuring `createAssetServer` (`remix.json` + `loadConfig()`, `mounts`,
  `allowFiles`/`allowPackages`/`denyFiles`, fingerprinting, HMR, compiler
  options)
- Choosing between `staticFiles()` for already-built files and
  `createAssetServer()` for source assets that need import rewriting, preloads,
  or fingerprinted URLs
- Generating import maps, script URLs, and `<link rel="modulepreload">` tags for
  a client entry with `getScriptEntry()` and `<ImportMap>`
- Keeping server-only files out of the browser via `denyFiles` rules

For routing the URL namespace itself, see `routing-and-controllers.md`. For
client entry hydration, see `hydration-frames-navigation.md`.

## When To Reach For It

Use `remix/assets` when the app serves browser JavaScript, TypeScript, or CSS
from source files. This is the right tool for client entrypoints, browser-only
helpers, styles under `app/assets/`, and monorepo code that should be compiled
and served under a public URL namespace.

Use `staticFiles()` for files that already exist on disk exactly as they should
be served. Use `createAssetServer()` for source scripts or styles that need
rewriting, dependency scanning, preloads, sourcemaps, or fingerprinted URLs.

## Default Pattern

Keep the shared asset configuration in `remix.json` so the CLI (`remix assets`,
`remix assets inspect <url-or-file>`) and the server agree, and load it with
`loadConfig()`:

```json
{
	"$schema": "./node_modules/remix/schema/remix.json",
	"assets": {
		"rootDir": ".",
		"basePath": "/assets",
		"allowFiles": ["app/client/**", "app/components/**", "app/assets/**"],
		"allowPackages": ["remix"],
		"denyFiles": ["app/**/*.test.*"]
	}
}
```

```typescript
import { createAssetServer } from 'remix/assets'
import { loadConfig } from 'remix/cli'
import { createRouter } from 'remix/router'

let isDevelopment = process.env.NODE_ENV === 'development'
let isHmr = isDevelopment && Boolean(process.env.REMIX_NODE_HMR)
let config = await loadConfig(process.cwd())

let assets = createAssetServer({
	...config.assets,
	minify: !isDevelopment,
	sourceMaps: isDevelopment ? 'inline' : undefined,
	fingerprint: !isDevelopment,
	watch: isDevelopment,
	hmr: isHmr
		? {
				channel: async () =>
					(await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
				moduleImporter: 'remix/multiple-import-maps-polyfill',
			}
		: undefined,
	scripts: {
		loaders: isHmr
			? [(await import('remix/ui-hmr/assets')).uiHmr()]
			: undefined,
	},
})

let router = createRouter()

router.get(`${config.assets.basePath}/*path`, ({ request }) =>
	assets.fetch(request),
)
```

When `mounts` is omitted the asset server serves
`{ app: 'app', npm: 'node_modules' }` beneath `basePath`, so
`app/client/entry.tsx` is reachable at `/assets/app/client/entry.tsx` and
packages at `/assets/npm/<pkg>/...`. Only add `mounts` (directory-to-directory,
no wildcards) when the filesystem layout differs; the old `fileMap` option was
removed in rc.1.

## Rules

- Treat `allowFiles`, `allowPackages`, and `denyFiles` as the security boundary
  for browser-reachable source files. Every npm package imported by browser code
  must be listed in `allowPackages`.
- Add a `denyFiles` list for server-only modules such as `*.server.*`, tests,
  private config, or other files that should never be exposed.
- Packages must ship ESM. For a CommonJS-only dependency, mark it
  `scripts.external` and add an ESM stand-in under `app/client/vendor/`, then
  add the mapping to the import map you render.
- CSS files are compiled and served alongside scripts. Local CSS `@import` rules
  are rewritten and fingerprinted with the same asset server routing rules.

## Rendering HTML

Browser scripts resolve their imports through an import map. Use
`getScriptEntry()` for each entry and render `<ImportMap>` from
`remix/ui/server` before the entry's modulepreload links and module script:

```tsx
import { ImportMap } from 'remix/ui/server'

let { href, importMap, preloads } = await assets.getScriptEntry(
	'app/client/admin/entry.tsx',
)

;<head>
	<ImportMap value={importMap} />
	{preloads.map((preloadHref) => (
		<link key={preloadHref} rel="modulepreload" href={preloadHref} />
	))}
	<script type="module" src={href}></script>
</head>
```

`<ImportMap>` merges the entry map with mappings from blocking client entries so
the document contains one complete import map. `assets.getHref(file)` still
returns a single public URL (useful for stylesheets). `assets.getImportMap()`
combines maps for several entries. The separate `getPreloads()` call was removed
in rc.2.

When HTML is embedded on another origin (for example MCP UI widgets), make both
the URL-like import-map keys and all values absolute against the server origin;
keep bare specifiers such as `remix/ui` unchanged.

Prefer the standard `render({ assets })` middleware from
`remix/middleware/render` for Remix UI documents: it resolves `clientEntry`
components with `getScriptEntry()` and includes their import maps in documents
and frame responses. If you call `renderToStream()` directly, return `href`,
`importMap`, `exportName`, and `preloads` from `resolveClientEntry()`.

## Development vs Deployment

In development:

- Keep `watch` enabled so source changes are picked up without restarting the
  server
- Enable source maps when debugging browser code
- Run the server under `remix/node-hmr`
  (`run('./index.ts', { nodeArgs: ['--import', 'remix/node-tsx', '--import', 'remix/ui-hmr/node'] })`),
  call `emitServerReady()` once listening, and configure `hmr` with
  `moduleImporter: 'remix/multiple-import-maps-polyfill'`. Client entries should
  load modules via `importModule()` from `remix/multiple-import-maps-polyfill`
  so the importer is part of the initial import map.

In deployment:

- Set `watch: false`
- Use `fingerprint: true` for long-lived immutable caching; fingerprints hash
  the final emitted bytes, so no `buildId` is needed
- If you persist a `files.cache` across restarts, set `files.cacheKey` to a
  per-deploy value

Fingerprinting assumes files on disk are stable and requires `watch: false`.

## Useful Compiler Options

- `minify` for production minification of scripts and styles
- `sourceMaps` for `'external'` or `'inline'` source maps for scripts and styles
- `sourceMapSourcePaths` for `'url'` or `'absolute'` source map paths
- `target` as an object for shared browser targets and script-only ECMAScript
  output, such as `{ es: '2020', chrome: '109', safari: '16.4' }`
- `scripts.define` to replace globals such as `process.env.NODE_ENV`
- `scripts.external` to leave specific script imports untouched

Do not nest shared compiler options under `scripts`. Use top-level `minify`,
`sourceMaps`, `sourceMapSourcePaths`, and `target` so they apply to styles as
well as scripts.

## Lifecycle

If the asset server is long-lived and watching the file system, call
`await assetServer.close()` when shutting down dev servers or disposing tests.
