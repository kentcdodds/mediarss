# Remix 3.0.0-alpha.3 Upgrade Notes

This project is upgraded to `remix@3.0.0-alpha.3`.

## Why this release matters

`remix@3.0.0-alpha.3` includes:

- removal of root `remix` exports (subpath imports only)
- a decoupled route utility export (`remix/fetch-router/routes`)
- updated `@remix-run/component` and `@remix-run/fetch-router` packages

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

### Not adopted yet (intentional)

- `remix/data-schema` (+ checks/coerce/lazy)
- `remix/data-table` (+ mysql/postgres/sqlite)
- `remix/file-storage-s3`
- `remix/session-storage-memcache`
- `remix/session-storage-redis`

Reason: the current app already has stable, tested abstractions for validation,
storage, and database access. We should only adopt these packages in targeted
follow-up refactors where we can preserve behavior and test each migration in
isolation.

## Router behavior expectation

Admin route changes should happen through History API navigation without a full
document reload. This is now required behavior and should be covered by tests.
