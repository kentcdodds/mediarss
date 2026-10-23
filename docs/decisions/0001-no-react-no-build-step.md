# 0001: No React and no build step

Status: accepted Date: 2026-10-23

## Decision

Do not introduce React, Preact, or any other UI framework, and do not add a
build or bundling step. UI uses `remix/component`; the server runs TypeScript
directly with `node --import remix/node-tsx`, and browser code is served on
demand by `remix/assets`.

## Why

The app is small and self-hosted. Shipping source as-is keeps the Docker image
simple, makes `/health` SHAs map directly to source, and avoids a second
toolchain. `remix/component` covers the admin UI and MCP widgets.

## Revisit if

`remix/component` cannot express a needed UI pattern, or `remix/assets` cannot
serve a required dependency without a bundler.
