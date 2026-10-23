# 0004: Media files are read-only by default

Status: accepted Date: 2026-10-23

## Decision

Code must not write, move, rename, or delete files under `MEDIA_PATHS` except
through the explicit features built for it: media upload
(`/admin/api/media/upload`) and metadata editing
(`/admin/api/media/*path/metadata`, MCP metadata tools). New write paths need
Kent's approval. Tests and the control CLI work on copies
(`data/control/<port>/media`), never on `test/fixtures` or real media.

## Why

The media library is Kent's personal collection, often mounted read-only. A bug
in a write path can corrupt or lose files that have no other copy in the app.

## Revisit if

Kent wants a new media-management feature (rename, delete, move) and approves
its design.
