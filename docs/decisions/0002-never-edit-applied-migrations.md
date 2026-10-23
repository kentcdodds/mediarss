# 0002: Never edit an applied migration

Status: accepted Date: 2026-10-23

## Decision

Never edit, rename, or delete a migration directory under `app/db/migrations/`
once it has merged. Change the schema with a new
`<YYYYMMDDHHmmss>_<slug>/up.sql` and a matching `down.sql`, and update
`app/db/schema.ts` in the same PR. Do not ship a migration without `down.sql`.

## Why

Migrations run automatically at container start against Kent's only copy of the
data. The runner journals applied migrations and refuses to start if an applied
migration's files changed, so an edit takes the NAS app down. A `down.sql` keeps
`npx remix db rollback` available for the
[rollback runbook](../runbooks/rollback.md).

## Revisit if

The app gains a second deployment with disposable data, or the migration runner
gains a supported squash/rebaseline flow.
