# Rollback runbook

MediaRSS has no feature flags (single-user, self-hosted). Recovery is: put the
schema back if needed, then run the previous image. NAS backups are handled
outside the app.

## 1. Find the last good image

Every push to `main` publishes `kentcdodds/mediarss:sha-<full sha>` and moves
`latest`. Tags also publish `:<version>`.

```sh
git log --oneline -10 origin/main         # pick the last good commit
npm run --silent control -- health --published --sha <good-sha>
```

## 2. Stop the bad container and fix the schema first

```sh
docker stop mediarss && docker rm mediarss
```

Additive migrations leave the previous image able to start against the same
database; skip to step 3.

If the bad release ran a migration the old image cannot run against, roll it
back **before** starting the old image. The bad image has the migration files
and the Remix CLI, so run it once against the same data volume:

```sh
docker run --rm -v /path/to/your/data:/data kentcdodds/mediarss:sha-<bad-sha> \
  npx remix db status
docker run --rm -v /path/to/your/data:/data kentcdodds/mediarss:sha-<bad-sha> \
  npx remix db rollback --dry-run
docker run --rm -v /path/to/your/data:/data kentcdodds/mediarss:sha-<bad-sha> \
  npx remix db rollback          # runs the newest migration's down.sql
```

If there is no usable `down.sql`, restore `sqlite.db` from the NAS backup taken
before the upgrade. `cache.db` is safe to delete; it rebuilds.

## 3. Run the previous image

```sh
docker pull kentcdodds/mediarss:sha-<good-sha>
# Re-run the same `docker run` (or scripts/nas-setup.sh) with the image set to
# kentcdodds/mediarss:sha-<good-sha> instead of :latest.
```

Pinning the SHA tag keeps auto-updaters from pulling the bad `latest` again.
Unpin once a fix is on `main`.

## 4. Confirm

```sh
npm run --silent control -- health --origin https://<your-mediarss-host> --sha <good-sha>
```

Then revert or fix forward on `main` with a normal PR, and file a `Cleanup:`
issue to unpin the image tag.

## Legacy `schema_versions` databases

A database with a `schema_versions` table (the in-app journal from before
`remix db`) starts only when that journal is at version 8. The baseline
migration is idempotent and leaves `schema_versions` in place so the prior
release image can start. A database older than version 8 needs one start on the
prior release first.
