# 0006: Frontend dependencies need `allowPackages`

Status: accepted Date: 2026-10-23

## Decision

Keep browser dependencies to the bare minimum. Every `node_modules` package used
by browser code must be listed in `assets.allowPackages` in `remix.json` and
must ship ESM. CommonJS-only packages need an ESM shim under
`app/client/vendor/` marked as `scripts.external` in `app/assets.ts`. Do not
work around the asset server's allow list.

## Why

`remix/assets` serves files on demand with no bundler
([0001](0001-no-react-no-build-step.md)); the allow list is what keeps
server-only code and arbitrary packages from being reachable by browsers.

## Revisit if

The asset server gains a different trust model, or a needed dependency cannot be
shimmed.
