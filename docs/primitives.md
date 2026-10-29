# Primitives and code roots

Reach for these before writing something new. Each line names the owner of a
concern; extend it instead of duplicating it.

## Server

- `index.ts`: startup order (migrate, prune analytics, ensure OAuth client and
  signing key, listen, warm media cache).
- `app/routes.ts`: the route contract (patterns, methods, `href()`); the
  [Feature Map](../.agents/skills/control-mediarss/references/feature-map.md) is
  generated from it.
- `app/router.tsx`: maps routes to handlers and middleware.
- `app/routes/`: HTTP handlers. `admin/api/*` is the JSON API; `feed.ts` /
  `media.ts` / `art.ts` are the public token routes; `mcp/widget.ts` is the
  feed-token player; `oauth/*`, `mcp/*`, and `health.ts` (public `/health`) are
  the rest. `/admin/health` is the same payload, served from
  `admin/api/health.ts` (the URL is `/admin/health`, not `/admin/api/health`).
  Admin HTML is `app/routes/admin/document.tsx` (shell), `index.tsx` (handler),
  and `loaders.ts` (first-paint data for the feed list, create, media, and
  version); `authorize.tsx` is OAuth consent. Pages live in `app/client/admin/`.
- `app/middleware/`: `logger.ts`, `rate-limit.ts` (limits from env).
- `app/config/env.ts`: the startup schema and media roots (`getEnv`,
  `getMediaRootByName`, `parseMediaPath`, `toAbsolutePath`). `COMMIT_SHA` /
  `SOURCE_COMMIT` (`version.ts`) and `ALLOWED_HOSTS` (`oauth/token.ts`) are read
  from `process.env` outside that schema. `app/config/init-env.ts` parses env
  and sets outbound IPv4-first DNS.

## Data

- `app/db/index.ts` (`db`), `schema.ts` (tables), `migrations/` (SQL),
  `migrate.ts` (startup migrator), `rows.ts` (typed raw reads), `types.ts`
  (shared `TableRow` aliases), `test-database.ts` (in-memory test DB).
- Feed data modules in `app/db/`: `directory-feeds.ts`, `curated-feeds.ts`,
  `feed-items.ts`, `directory-feed-tokens.ts`, `curated-feed-tokens.ts`,
  `feed-analytics-events.ts`.
- Analytics helpers: `app/helpers/analytics-window.ts` (days query) and
  `analytics-request.ts` (client identity for recorded events).
- `app/cache/cache.ts`: separate cache database for media metadata.

## Media and feeds

- `app/helpers/media.ts`: scan and read media metadata (cached).
- `app/helpers/rss.ts`: RSS/iTunes XML generation. `app/helpers/feed-items.ts`
  and `app/helpers/sort.ts` order items; `description-html.ts` sanitizes
  descriptions. `app/helpers/path-parsing.ts` parses splat media paths.
- `app/helpers/range-request.ts`, `node-file.ts`: streaming with ranges.
- `app/helpers/feed-access.ts`, `feed-lookup.ts`, `feed-url.ts`: token lookup
  and public URLs; `origin.ts` resolves the public origin behind proxies.
- Artwork: `artwork.ts` (embedded), `feed-artwork*.ts` (uploads in
  `data/artwork`), `square-artwork.ts`, `podcast-art-*.ts`,
  `placeholder-svg.ts`.
- `app/helpers/ffmpeg.ts`, `media-metadata-edit.ts`: write tags into media
  files.

## Auth and MCP

- `app/oauth/`: authorization codes, PKCE, tokens, refresh tokens, signing keys,
  client metadata documents (`client-metadata.ts` fetches CIMD).
- `app/mcp/`: MCP server, tools, resources, prompts, widgets, auth, and
  protocol-header checks. `feed-helpers.ts` is the shared feed lookup used by
  tools, resources, and prompts. `metadata.ts` is the source of truth for names
  and descriptions ([conventions](mcp-server-best-practices.md)).

## UI

- `app/client/admin/`: the admin SPA (`entry.tsx`, `app-root.tsx` holds the page
  registry, `admin-pages.ts` matches URLs; `FeedDetail` and `MediaDetail` each
  serve their view and edit routes; `url-state.ts` for URL-synced state).
  `app/helpers/feed-list-sort.ts` and `media-list-sort.ts` own the admin list
  sort keys.
- `app/client/widgets/`: MCP UI widgets.
- `app/components/`, `app/styles/`: shared components and style tokens.

## Ops and tooling

- `app/helpers/health.ts`, `version.ts`, `diagnostics.ts`: `/health` and
  `/admin/health` (same payload). Optional `?probe=cimd` live-fetches Kody's
  client metadata. Commit SHA from `COMMIT_SHA` (`SOURCE_COMMIT` is an accepted
  alias).
- `app/helpers/outbound-fetch.ts`: IPv4-first outbound HTTP (CIMD, NAS Docker).
- `server/dev.ts`: HMR supervisor for `npm run dev`. `server/node-server.ts` is
  the Node HTTP adapter. `server/cli.ts` is the interactive keyboard shortcuts
  (`o`/`u`/`c`/`h`/`q`).
- `tools/control-mediarss.ts`: the control CLI
  ([skill](../.agents/skills/control-mediarss/SKILL.md)).
- `scripts/release.ts`: version bump, tag, GitHub release.
- `scripts/nas-setup.sh`: NAS container setup.
