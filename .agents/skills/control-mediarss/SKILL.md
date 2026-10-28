---
name: control-mediarss
description:
  Run and prove MediaRSS changes with the control CLI (doctor, dev, request,
  execute, browse, map, health). Use for every check of the running app and for
  the Testing section of a PR.
---

# control-mediarss

Use the CLI for every check of the running app. It drives a local server on
fixture media with its own databases, so it never touches `./data/sqlite.db` or
real media.

```sh
C() { npm run --silent control -- "$@"; }

C doctor                       # node, deps, git hooks, Chromium, ffmpeg, server
C dev                          # start or reuse http://127.0.0.1:22051
C dev --fresh                  # wipe data/control/22051 and start clean
C dev --foreground             # run in this terminal (logs stay attached)
C request GET /admin/api/media --contains Inkheart
C request POST /admin/api/feeds/directory \
  --json-body '{"name":"Audio","directoryPaths":["audio:"]}' --status 201
C execute --code-file tools/control-fixtures/curated-feed.ts   # seeds a feed, prints id + token
C request GET /feed/<token> --contains "<rss"
C browse --path /admin/media --wait-for "Media Library" --record
C map                          # every route; `map feed` prints seed + reach notes
C map --check                  # CI runs this through `npm test`
C health --sha "$(git rev-parse HEAD)"
C health --published --sha <merge-sha> --wait 900   # Docker Hub has the image
C stop
```

Every command takes `--json`. `doctor`, `request`, `execute`, `browse`, and
`health` take `--origin <url>`; `dev` and `stop` take `--port`. `request` also
takes `--status`, `--not-contains`, `--header "k: v"`, `--body`, and
`--dump <file>` (binary bodies are summarized, not printed).

## Environment

- Media roots `audio` and `video` are copies of `test/fixtures/` under
  `data/control/<port>/media`, so upload and metadata-edit proofs are safe.
  `dev --fresh` resets them.
- No login: admin has no app-level auth (Cloudflare Access guards it in
  production,
  [decision 0005](../../../docs/decisions/0005-admin-auth-lives-at-cloudflare-access.md)).
  MCP needs an OAuth token; the `app/oauth` and `app/mcp` tests cover that flow.
- Uploaded feed artwork goes to the shared `./data/artwork` directory (the path
  is fixed in `app/helpers/feed-artwork.ts`).
- Playwright (`npm run test:playwright`) starts its own fresh server on port
  22052, so it never disturbs yours.

## Seeding

Write a fixture module for the change and run it with `execute`. Its default
export receives `{ origin, params, request, json }` (see
`tools/control-context.ts`); return what you want printed. Start from
`tools/control-fixtures/curated-feed.ts`. Keep throwaway fixtures out of the PR
unless they are worth reusing.

## Previews

There are none; MediaRSS is self-hosted. Production-like checks (Docker image,
startup migrations) happen in CI's Build job, which runs the image and checks
`/health`.

## Proof

1. Add or update the test that covers the change; `npm run validate`.
2. `doctor`, then `dev` (`--fresh` when the change touches migrations or
   startup).
3. `request ... --contains` or `execute --code-file <fixture>` with data for
   this change.
4. UI: `browse --path <page> --record`; attach the screenshot or video.
5. After merge: `health --published --sha <merge-sha> --wait 900`.

Cite the exact commands and results under **Testing** in the PR.

See the [Feature Map](references/feature-map.md) for every route's seed and
reach notes. When you add a route, add its note to `tools/feature-notes.ts`
(typecheck requires it) and run `C map --write`.
