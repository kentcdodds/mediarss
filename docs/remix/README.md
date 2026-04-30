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
- Use the package table to jump to the README or package docs you need.
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

| Package                      | Docs                                             |
| ---------------------------- | ------------------------------------------------ |
| `assert`                     | [README](./assert/README.md)                     |
| `assets`                     | [README](./assets/README.md)                     |
| `async-context-middleware`   | [README](./async-context-middleware/README.md)   |
| `auth`                       | [README](./auth/README.md)                       |
| `auth-middleware`            | [README](./auth-middleware/README.md)            |
| `cli`                        | [README](./cli/README.md)                        |
| `compression-middleware`     | [README](./compression-middleware/README.md)     |
| `cookie`                     | [README](./cookie/README.md)                     |
| `cop-middleware`             | [README](./cop-middleware/README.md)             |
| `cors-middleware`            | [README](./cors-middleware/README.md)            |
| `csrf-middleware`            | [README](./csrf-middleware/README.md)            |
| `data-schema`                | [README](./data-schema/README.md)                |
| `data-table`                 | [README](./data-table/README.md)                 |
| `data-table-mysql`           | [README](./data-table-mysql/README.md)           |
| `data-table-postgres`        | [README](./data-table-postgres/README.md)        |
| `data-table-sqlite`          | [README](./data-table-sqlite/README.md)          |
| `fetch-proxy`                | [README](./fetch-proxy/README.md)                |
| `fetch-router`               | [README](./fetch-router/README.md)               |
| `file-storage`               | [README](./file-storage/README.md)               |
| `file-storage-s3`            | [README](./file-storage-s3/README.md)            |
| `form-data-middleware`       | [README](./form-data-middleware/README.md)       |
| `form-data-parser`           | [README](./form-data-parser/README.md)           |
| `fs`                         | [README](./fs/README.md)                         |
| `headers`                    | [README](./headers/README.md)                    |
| `html-template`              | [README](./html-template/README.md)              |
| `lazy-file`                  | [README](./lazy-file/README.md)                  |
| `logger-middleware`          | [README](./logger-middleware/README.md)          |
| `method-override-middleware` | [README](./method-override-middleware/README.md) |
| `mime`                       | [README](./mime/README.md)                       |
| `multipart-parser`           | [README](./multipart-parser/README.md)           |
| `node-fetch-server`          | [README](./node-fetch-server/README.md)          |
| `remix`                      | [README](./remix/README.md)                      |
| `response`                   | [README](./response/README.md)                   |
| `route-pattern`              | [README](./route-pattern/README.md)              |
| `session`                    | [README](./session/README.md)                    |
| `session-middleware`         | [README](./session-middleware/README.md)         |
| `session-storage-memcache`   | [README](./session-storage-memcache/README.md)   |
| `session-storage-redis`      | [README](./session-storage-redis/README.md)      |
| `static-middleware`          | [README](./static-middleware/README.md)          |
| `tar-parser`                 | [README](./tar-parser/README.md)                 |
| `terminal`                   | [README](./terminal/README.md)                   |
| `test`                       | [README](./test/README.md)                       |
| `ui`                         | [README](./ui/README.md) / [docs](./ui/docs/)    |
