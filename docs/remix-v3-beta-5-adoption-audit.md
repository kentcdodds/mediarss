# Remix v3 Beta 5 adoption audit

This repository is already on Remix v3 Beta 5:

- `package.json` pins `remix` to `3.0.0-beta.5`.
- `package-lock.json` resolves that exact version, including
  `@remix-run/node-fetch-server@^0.14.0`.
- Imports already use `remix/*` subpaths. There are no legacy top-level `remix`
  imports or `remix/ui/components/*` imports to migrate.

The findings below compare the repository with the
[Beta 5 release](https://github.com/remix-run/remix/releases/tag/remix@3.0.0-beta.5)
and the template installed at `node_modules/@remix-run/cli/template`.

## Recommendations

### High priority

1. **Adopt first-party controls where they preserve the existing interaction
   contract.**

   Implemented in this audit:
   - `app/components/search-input.tsx` now composes the existing themed search
     field and clear action around `remix/ui/input`.
   - `app/client/admin/media-list.tsx` now uses `remix/ui/checkbox`, including
     its native mixed state, instead of a visually hidden input plus custom
     check and dash SVGs.
   - `app/client/admin/media-detail.tsx` now uses `remix/ui/toggle` for feed
     assignments instead of a custom `role="switch"` button and thumb.

   These are isolated controls with direct primitive equivalents. They remove
   custom control mechanics while retaining MediaRSS colors, state ownership,
   event propagation, and accessible names. The app has no third-party component
   library, so no dependency can be removed.

2. **Replace per-request browser bundling with `remix/assets`, in a dedicated
   follow-up.**

   `server/bundling.ts` invokes esbuild for every `/app/client/*` and
   `/node_modules/*` request. The Beta 5 template instead creates one asset
   server in `app/assets.ts` with production minification and `watch: false`,
   then uses `getHref()` and `resolveClientEntry`.

   This is likely the largest production-start and request-latency improvement,
   but it is not a safe drive-by change. A migration must preserve:
   - cross-origin module responses used by `app/mcp/widgets.ts`;
   - the bundled singleton Remix UI runtime expected by
     `app/client/admin/entry.tsx`;
   - versioned URLs and long-lived cache behavior from
     `app/helpers/bundle-version.ts`;
   - admin frame resolution in `app/helpers/render.ts` and
     `app/client/admin/entry.tsx`.

   Validate admin hydration, MCP widgets in a cross-origin host, response CORS,
   and production cache headers before removing the custom bundler.

3. **Wait for the HTTP server during graceful shutdown.**

   Implemented in `server/cli.ts`. The `close-with-grace` callback previously
   started `server.stop(true)` without awaiting it, allowing the callback to
   finish before Node stopped accepting requests. The callback now awaits the
   existing `AppServer.stop()` promise.

   The Beta 5 template uses `server.close()` followed by
   `server.closeAllConnections()`. MediaRSS's wrapper is more reusable and
   preserves in-flight connections, so replacing it wholesale would not be an
   improvement.

### Medium priority

1. **Expand style primitive adoption after visual review.**
   - `app/components/modal.tsx` (`ModalButton`) and repeated action styles in
     `app/client/admin/create-feed.tsx` are candidates for `remix/ui/button`.
   - The repeated `inputStyles` objects in `create-feed.tsx`, `feed-detail.tsx`,
     and `media-detail.tsx` are candidates for a shared, themed wrapper around
     `remix/ui/input`.

   Beta 5's default button and input palettes are light and neutral, while this
   app supports an amber dark theme. Compose app-owned token overrides rather
   than accepting a broad visual change.

2. **Pilot `remix/ui/select` on one non-form filter.**

   Start with `app/client/admin/feed-list.tsx` (`#feed-sort`) before migrating
   the 12 other native selects in admin pages. The first-party Select adds
   listbox, popover, keyboard, and typeahead behavior, but it also changes a
   familiar native control and its state API. That UX choice and dark-theme
   styling should be reviewed before a broad conversion.

3. **Complete the Beta 5 frame and client-entry pipeline with the asset
   migration.**

   `app/helpers/render.ts` supplies `frameSrc` but not server-side
   `resolveFrame` or `resolveClientEntry`. `app/client/admin/entry.tsx` has a
   client `resolveFrame`, but uses a manual module registry and hard-coded entry
   ID. The template's `renderToStream` resolver and `import.meta.url` client
   entries are simpler, but depend on `assetServer.getHref()` and should move
   together with recommendation H2.

4. **Align global CSS cascade layers before broad primitive adoption.**

   `app/assets/styles.css` is currently unlayered, while Remix UI emits styles
   in the `rmx` layer. Put reset rules in an explicit `base` layer and declare
   `@layer base, rmx;` before adopting controls across the whole admin UI.
   Preserve the existing mobile 16px form-control rule to avoid iOS zoom.

### Low priority

1. `remix/ui/breadcrumbs` could improve multi-level admin navigation in
   `feed-detail.tsx` and `media-detail.tsx`, but it is not a replacement for
   single “Back” links or file-system path displays.
2. `remix/ui/tabs` may fit the analytics range control in
   `app/client/admin/feed-detail.tsx`. The feed-type filters navigate URL state
   rather than switching tab panels, so changing those would be semantic churn.
3. `remix/ui/accordion`, `combobox`, and `menu` do not match a current product
   interaction. Adding collapsible sections or action menus would be a product
   change, not framework cleanup.
4. Keep `app/components/modal.tsx`. Beta 5 supplies popover positioning and
   behavior, not a drop-in modal/dialog component.

## Trusted proxy assessment

`server/node-server.ts` already passes `trustProxy: true` to
`createRequestListener`, and `app/helpers/origin.test.ts` verifies that trusted
`X-Forwarded-Proto` and `X-Forwarded-Host` values produce the public request
URL.

That setting fits the documented topology in `README.md`: HTTPS terminates at
Cloudflare Tunnel (or another trusted reverse proxy) and the proxy reaches the
Node server over HTTP. Public origins affect RSS links, MCP/OAuth metadata,
redirects, and OAuth host checks.

The operational prerequisite is important: port 22050 must be reachable only
through a proxy that overwrites `Forwarded` and `X-Forwarded-*` headers. A
directly exposed listener would let callers spoof scheme, host, and client
address. `ALLOWED_HOSTS` should also be configured for production OAuth
deployments. `trustProxy` does not currently centralize rate-limit or analytics
IP parsing because the application handler does not consume the adapter's second
`client` argument.

## Beta 5 template comparison

Already aligned or stronger than the template:

- `package.json` and `Dockerfile` explicitly start production with
  `NODE_ENV=production`.
- `server/bundling.ts` already minifies browser bundles in production.
- Development uses Node's watcher.
- `app/config/env.ts` validates configuration, the server binds explicitly for
  containers, the image has a health route, and shutdown is centralized.
- The custom TypeScript hook enables Node's compile cache and a test
  compatibility hook. Replacing it with `remix/node-tsx` is not a clear win.

Worth adopting:

- `remix/assets` with stable production asset compilation and `getHref()`;
- matching server/client frame resolution and `resolveClientEntry`;
- suppressing expected top-level errors when `request.signal` was aborted;
- production cache headers for versioned `/app/client/*` responses if the
  asset-server migration is deferred.

Not worth copying:

- the template's port, directory names, minimal environment handling, or direct
  signal handlers; MediaRSS has intentional deployment-specific defaults and a
  richer shutdown wrapper.
