# Remix package docs

MediaRSS runs on Remix v3 alpha APIs exposed through the unified `remix`
package.

This directory mirrors upstream package documentation from the Remix monorepo at
`remix@3.0.0-alpha.6`. Package docs are copied from the tagged source release,
and release notes are collected with `gh release view` for the umbrella release
and every package release linked from it.

## Agent quick start

- Start with [alpha.6 release notes](./release-notes.md) for breaking changes
  and package bumps.
- Use the package table to jump to the README, changelog, or package docs you
  need.
- Use [`ui`](./ui/README.md) for component APIs; alpha.6 removes the old
  `remix/component` exports.
- Use [`multipart-parser`](./multipart-parser/README.md) when handling multipart
  parts; alpha.6 changes part headers to a decoded object keyed by lower-case
  header name.
- Prefer these mirrored docs over ad-hoc web searches when changing Remix
  integrations in this repo.

## Release-note coverage

- remix@3.0.0-alpha.6
- assets@0.2.0
- auth@0.2.0
- cli@0.1.0
- compression-middleware@0.1.6
- data-schema@0.3.0
- data-table-sqlite@0.4.0
- fetch-proxy@0.8.0
- file-storage@0.13.4
- file-storage-s3@0.1.1
- form-data-middleware@0.2.2
- form-data-parser@0.17.0
- fs@0.4.3
- lazy-file@5.0.3
- logger-middleware@0.2.0
- mime@0.4.1
- multipart-parser@0.16.0
- response@0.3.3
- static-middleware@0.4.7
- tar-parser@0.7.1
- terminal@0.1.0
- test@0.2.0
- ui@0.1.0

## Mirrored packages

| Package                      | Docs                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `assert`                     | [README](./assert/README.md) / [changelog](./assert/CHANGELOG.md)                                         |
| `assets`                     | [README](./assets/README.md) / [changelog](./assets/CHANGELOG.md)                                         |
| `async-context-middleware`   | [README](./async-context-middleware/README.md) / [changelog](./async-context-middleware/CHANGELOG.md)     |
| `auth`                       | [README](./auth/README.md) / [changelog](./auth/CHANGELOG.md)                                             |
| `auth-middleware`            | [README](./auth-middleware/README.md) / [changelog](./auth-middleware/CHANGELOG.md)                       |
| `cli`                        | [README](./cli/README.md) / [changelog](./cli/CHANGELOG.md)                                               |
| `compression-middleware`     | [README](./compression-middleware/README.md) / [changelog](./compression-middleware/CHANGELOG.md)         |
| `cookie`                     | [README](./cookie/README.md) / [changelog](./cookie/CHANGELOG.md)                                         |
| `cop-middleware`             | [README](./cop-middleware/README.md) / [changelog](./cop-middleware/CHANGELOG.md)                         |
| `cors-middleware`            | [README](./cors-middleware/README.md) / [changelog](./cors-middleware/CHANGELOG.md)                       |
| `csrf-middleware`            | [README](./csrf-middleware/README.md) / [changelog](./csrf-middleware/CHANGELOG.md)                       |
| `data-schema`                | [README](./data-schema/README.md) / [changelog](./data-schema/CHANGELOG.md)                               |
| `data-table`                 | [README](./data-table/README.md) / [changelog](./data-table/CHANGELOG.md)                                 |
| `data-table-mysql`           | [README](./data-table-mysql/README.md) / [changelog](./data-table-mysql/CHANGELOG.md)                     |
| `data-table-postgres`        | [README](./data-table-postgres/README.md) / [changelog](./data-table-postgres/CHANGELOG.md)               |
| `data-table-sqlite`          | [README](./data-table-sqlite/README.md) / [changelog](./data-table-sqlite/CHANGELOG.md)                   |
| `fetch-proxy`                | [README](./fetch-proxy/README.md) / [changelog](./fetch-proxy/CHANGELOG.md)                               |
| `fetch-router`               | [README](./fetch-router/README.md) / [changelog](./fetch-router/CHANGELOG.md)                             |
| `file-storage`               | [README](./file-storage/README.md) / [changelog](./file-storage/CHANGELOG.md)                             |
| `file-storage-s3`            | [README](./file-storage-s3/README.md) / [changelog](./file-storage-s3/CHANGELOG.md)                       |
| `form-data-middleware`       | [README](./form-data-middleware/README.md) / [changelog](./form-data-middleware/CHANGELOG.md)             |
| `form-data-parser`           | [README](./form-data-parser/README.md) / [changelog](./form-data-parser/CHANGELOG.md)                     |
| `fs`                         | [README](./fs/README.md) / [changelog](./fs/CHANGELOG.md)                                                 |
| `headers`                    | [README](./headers/README.md) / [changelog](./headers/CHANGELOG.md)                                       |
| `html-template`              | [README](./html-template/README.md) / [changelog](./html-template/CHANGELOG.md)                           |
| `lazy-file`                  | [README](./lazy-file/README.md) / [changelog](./lazy-file/CHANGELOG.md)                                   |
| `logger-middleware`          | [README](./logger-middleware/README.md) / [changelog](./logger-middleware/CHANGELOG.md)                   |
| `method-override-middleware` | [README](./method-override-middleware/README.md) / [changelog](./method-override-middleware/CHANGELOG.md) |
| `mime`                       | [README](./mime/README.md) / [changelog](./mime/CHANGELOG.md)                                             |
| `multipart-parser`           | [README](./multipart-parser/README.md) / [changelog](./multipart-parser/CHANGELOG.md)                     |
| `node-fetch-server`          | [README](./node-fetch-server/README.md) / [changelog](./node-fetch-server/CHANGELOG.md)                   |
| `remix`                      | [README](./remix/README.md) / [changelog](./remix/CHANGELOG.md)                                           |
| `response`                   | [README](./response/README.md) / [changelog](./response/CHANGELOG.md)                                     |
| `route-pattern`              | [README](./route-pattern/README.md) / [changelog](./route-pattern/CHANGELOG.md)                           |
| `session`                    | [README](./session/README.md) / [changelog](./session/CHANGELOG.md)                                       |
| `session-middleware`         | [README](./session-middleware/README.md) / [changelog](./session-middleware/CHANGELOG.md)                 |
| `session-storage-memcache`   | [README](./session-storage-memcache/README.md) / [changelog](./session-storage-memcache/CHANGELOG.md)     |
| `session-storage-redis`      | [README](./session-storage-redis/README.md) / [changelog](./session-storage-redis/CHANGELOG.md)           |
| `static-middleware`          | [README](./static-middleware/README.md) / [changelog](./static-middleware/CHANGELOG.md)                   |
| `tar-parser`                 | [README](./tar-parser/README.md) / [changelog](./tar-parser/CHANGELOG.md)                                 |
| `terminal`                   | [README](./terminal/README.md) / [changelog](./terminal/CHANGELOG.md)                                     |
| `test`                       | [README](./test/README.md) / [changelog](./test/CHANGELOG.md)                                             |
| `ui`                         | [README](./ui/README.md) / [changelog](./ui/CHANGELOG.md) / [docs](./ui/docs/)                            |
