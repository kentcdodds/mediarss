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
- `app/routes/`: one handler module per route (`admin/api/*` JSON API, `admin/*`
  pages, `feed.ts` / `media.ts` / `art.ts` public token routes, `oauth/*`,
  `mcp/*`, `health.ts`).
- `app/middleware/`: `logger.ts`, `rate-limit.ts` (limits from env).
- `app/config/env.ts`: the env schema and media roots (`getEnv`,
  `getMediaRootByName`, `parseMediaPath`, `toAbsolutePath`).

## Data

- `app/db/index.ts` (`db`), `schema.ts` (tables), `migrations/` (SQL),
  `migrate.ts` (startup migrator), `rows.ts` (typed raw reads),
  `test-database.ts` (in-memory test DB).
- Feed data modules in `app/db/`: `directory-feeds.ts`, `curated-feeds.ts`,
  `feed-items.ts`, `directory-feed-tokens.ts`, `curated-feed-tokens.ts`,
  `feed-analytics-events.ts`.
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
  client metadata documents.
- `app/mcp/`: MCP server, tools, resources, prompts, widgets, auth.
  `metadata.ts` is the source of truth for names and descriptions
  ([conventions](mcp-server-best-practices.md)).

## UI

- `app/client/admin/`: the admin SPA (`entry.tsx`, `app-root.tsx`, one module
  per page, `url-state.ts` for URL-synced state).
- `app/client/widgets/`: MCP UI widgets.
- `app/components/`, `app/styles/`: shared components and style tokens.

## Ops and tooling

- `app/helpers/health.ts`, `version.ts`, `diagnostics.ts`: `/health` and version
  data (commit SHA from `COMMIT_SHA`).
- `tools/control-mediarss.ts`: the control CLI
  ([skill](../.agents/skills/control-mediarss/SKILL.md)).
- `scripts/release.ts`: version bump, tag, GitHub release.
- `scripts/nas-setup.sh`: NAS container setup.
