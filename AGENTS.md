Default to using Bun instead of Node.js.

## No React

This application does NOT use React. We use `@remix-run/component` for UI components. Do not introduce React, Preact, or any other UI framework.

## Bun

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Build

There is no build step. This is shipped as-is. Instead, we use Bun's built-in runtime typescript support and we do a runtime bundling of the client-side code in `server/bundling.ts`.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Manual Testing with Local Media

To test the application with sample media files, use the `local-test` directory:

```bash
bun run dev:test
```

This command:
- Sets `DATABASE_PATH=./data/test.db` (separate from production data)
- Sets `MEDIA_PATHS=./local-test/1/audio:./local-test/1/video`
- Runs the dev server with watch mode

The `local-test/1` directory contains sample media files:
- `audio/` - Audiobook files (.m4b, .m4a, .mp3)
- `video/` - Video files (.mkv)

You can add your own test media files to `local-test/` - this directory is gitignored.

## Frontend

We limit the number of frontend dependencies to the bare minimum. Each
`node_modules` package needs to be explicitly listed in the import map in the
`layout.tsx` file.
