# Rollback runbook

MediaRSS has no feature flags (single-user, self-hosted). Recovery is: run the
previous image, and restore data only if a migration or bug changed it. NAS
backups are handled outside the app.

## 1. Find the last good image

Every push to `main` publishes `kentcdodds/mediarss:sha-<full sha>` and moves
`latest`. Tags also publish `:<version>`.

```sh
git log --oneline -10 origin/main         # pick the last good commit
npm run --silent control -- health --published --sha <good-sha>
```

## 2. Run it on the NAS

```sh
docker pull kentcdodds/mediarss:sha-<good-sha>
docker stop mediarss && docker rm mediarss
# Re-run the same `docker run` (or scripts/nas-setup.sh) with the image set to
# kentcdodds/mediarss:sha-<good-sha> instead of :latest.
```

Pinning the SHA tag keeps auto-updaters from pulling the bad `latest` again.
Unpin once a fix is on `main`.

## 3. If the bad release ran a migration

Older images keep working after a newer migration as long as the migration only
added things (see "Data Persistence" in the README). If it did not, roll the
schema back before starting the old image:

```sh
# Inside the new (bad) container, or with DATABASE_PATH pointing at the file:
npx remix db status
npx remix db rollback --dry-run
npx remix db rollback        # runs the newest migration's down.sql
```

If there is no usable `down.sql`, stop the container and restore `sqlite.db`
(and `cache.db`, which is safe to delete; it rebuilds) from the NAS backup taken
before the upgrade.

## 4. Confirm

```sh
npm run --silent control -- health --origin https://<your-mediarss-host> --sha <good-sha>
```

Then revert or fix forward on `main` with a normal PR, and file a `Cleanup:`
issue to unpin the image tag.
