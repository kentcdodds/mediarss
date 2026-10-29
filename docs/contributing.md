# Contributing

How to work in this repo. [`AGENTS.md`](../AGENTS.md) is the short map; this
page holds the details.

## Gate

`npm run validate` is the only local gate: format check, lint, typecheck, and
tests (including the Feature Map check). CI (`.github/workflows/publish.yml`)
runs the same command, then Control CLI smoke + Playwright, then a Docker image
build and `/health` smoke. Do not commit if validate fails.

- `npm run check` auto-fixes format and lint (`npm run format`, `npm run lint`
  individually).
- Git hooks live in `.githooks` and are installed by `npm install` (the
  `prepare` script). Pre-commit runs the format and lint checks; pre-push runs
  the typecheck. If they are missing, run `npm run prepare`.
- Tests run against throwaway databases (`test/global-setup.ts`), never your
  `./data` files.

## Runtime and tooling

- Node.js and npm only. `npm install` to add dependencies; `npm run <script>`
  for scripts; `process.env` for environment variables.
- No build step. The server runs TypeScript directly via
  `node --import remix/node-tsx` (`.ts` and `.tsx`, JSX configured in
  `tsconfig.json`). Browser code is served on demand by the `remix/assets`
  server configured in `app/assets.ts` and `remix.json` (fingerprinted in
  production, import maps from `getScriptEntry()`). `npm run dev` supervises the
  server with `remix/node-hmr`.
- Server: Node HTTP plus `remix/node-fetch-server`. `WebSocket` is built in;
  don't use `ws`. Prefer `fs`, `fs/promises`, and web `File`/`Blob` APIs.

## Remix

Load the repo-local skill at `.agents/skills/remix/SKILL.md` before changing
routes, handlers, middleware, data access, validation, auth, sessions, uploads,
server setup, UI components, hydration, navigation, or tests. Start from the
installed docs: search `node_modules/remix/INDEX.md`, then follow links to
`node_modules/remix/guides/` and the package README. Installed docs are
canonical. This app's route contract is `app/routes.ts`, the router is
`app/router.tsx`, and handlers live in `app/routes/` (the skill's starter layout
is `app/router.ts` plus `app/actions/`). Sync the skill from the
`remix@<version>` tag when bumping Remix; there is no `remix skills install`.

UI uses `remix/component`, not React
([decision 0001](decisions/0001-no-react-no-build-step.md)).

## MCP

Streamable HTTP at `/mcp` with OAuth (PKCE). Names, titles, and descriptions
live in `app/mcp/metadata.ts`. Follow
[mcp-server-best-practices.md](mcp-server-best-practices.md) when changing
tools, resources, or prompts.

## Data layer

- `app/db/index.ts` exports the app `db` (`createSqliteDatabase` from
  `remix/data-table/sqlite`, backed by `node:sqlite`). `app/cache/cache.ts` owns
  a separate cache database with the same setup.
- Tables are declared once in `app/db/schema.ts`. Row types come from
  `TableRow<typeof someTable>` (shared aliases in `app/db/types.ts`); don't
  hand-write row shapes or cast results.
- Prefer the CRUD helpers (`db.find`, `db.findMany`, `db.create`, `db.update`,
  `db.updateMany`, `db.delete`, `db.deleteMany`) and `db.query(table)`. Use
  ``db.exec(sql`...`)`` (with `selectAll`/`selectOne` from `app/db/rows.ts`)
  only for aggregates, PRAGMAs, and SQL the builder can't express.
- All database calls are async; await them, including in tests.
- Schema changes are new SQL migrations in
  `app/db/migrations/<YYYYMMDDHHmmss>_<slug>/up.sql` plus `down.sql`
  ([decision 0002](decisions/0002-never-edit-applied-migrations.md)).
  `migrateDatabase()` runs at startup;
  `npx remix db status|migrate|rollback|reset` run the same migrations from the
  CLI.
- Database tests use `createTestDatabase()` from `app/db/test-database.ts`
  (in-memory, migrated). Module-level code that uses the shared `db` runs
  against the throwaway `DATABASE_PATH`; vitest runs one worker so those tests
  don't race.

## Testing

`npm test` runs vitest (`app/**/*.test.ts`, `app/**/*.test.tsx`,
`tools/**/*.test.ts`). `npm run test:playwright` runs the browser specs in
`playwright/` against a fresh control server. To prove a change against the
running app, use the control CLI
([skill](../.agents/skills/control-mediarss/SKILL.md)).

For manual testing with your own media, `npm run dev:test` uses `./data/test.db`
and `MEDIA_PATHS=audio:./local-test/1/audio` (`local-test/` is gitignored).
`npm run dev:test-mounted` is the same idea against host volumes listed in
`package.json`. Media path names must be unique.

## Frontend dependencies

Keep them minimal. Every `node_modules` package used by browser code must be
listed in `assets.allowPackages` in `remix.json` and must ship ESM;
CommonJS-only packages need an ESM shim under `app/client/vendor/` marked as
`scripts.external` in `app/assets.ts`
([decision 0006](decisions/0006-frontend-deps-need-allowpackages.md)).

## Issues and triage

Agents file issues on GitHub with the forms in `.github/ISSUE_TEMPLATE/`
(Friction, Cleanup). Every agent-filed issue gets exactly one priority label
and, when it needs Kent's call, `needs-decision`:

| Label            | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `P0`             | Broken for users or blocking agents now; work it next |
| `P1`             | Costs real time on most PRs; this week                |
| `P2`             | Worth fixing; when nothing higher is open             |
| `P3`             | Nice to have; batch it with nearby work               |
| `needs-decision` | A product or one-way-door call for Kent; agents wait  |

Agents work the highest priority first and leave `needs-decision` issues alone
until Kent answers and removes the label. `friction-skipped` marks a friction
issue the daily sweep looked at and left for a human.
