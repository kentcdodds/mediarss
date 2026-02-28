# Remix 3.0.0-alpha.3 Upgrade Notes

This project is upgraded to `remix@3.0.0-alpha.3`.

## Why this release matters

`remix@3.0.0-alpha.3` includes:

- removal of root `remix` exports (subpath imports only)
- a decoupled route utility export (`remix/fetch-router/routes`)
- updated `remix/component` and `remix/fetch-router` packages

## Project-level migration rules

When updating or adding code:

1. Never import from root `remix`.
2. Always import from subpaths such as:
   - `remix/component`
   - `remix/fetch-router`
   - `remix/fetch-router/routes`
3. Keep admin navigation client-side (no full-page refresh fallback).

## New alpha.3 exports: adoption decisions

### Adopted now

- `remix/fetch-router/routes`
  - Reason: this is the right API surface for route config modules and avoids
    pulling unnecessary server-oriented exports into route declaration files.
- `remix/data-schema` (+ checks/coerce where needed)
  - Reason: this now replaces app-level Zod usage for env parsing, DB row
    validation, cache metadata validation, media metadata validation, and client
    widget payload validation.
- `remix/data-table`
  - Reason: feed/feed-token/feed-item persistence now runs through
    `remix/data-table` table definitions and CRUD APIs, with an in-repo Bun
    adapter so we can keep using `bun:sqlite`.

### Not adopted yet (intentional)

- `remix/file-storage-s3`
- `remix/session-storage-memcache`
- `remix/session-storage-redis`

Reason: this app currently stores files locally and does not use Remix session
storage adapters, so these packages do not map to active runtime needs yet.

## Remaining Zod usage

`@modelcontextprotocol/sdk` tool/prompt schema registration currently expects
Zod-compatible schemas at runtime. Until MCP SDK supports Standard Schema for
that path, MCP tool/prompt argument schemas remain on Zod.

## Router behavior expectation

Admin route changes should happen through History API navigation without a full
document reload. This is now required behavior and should be covered by tests.
