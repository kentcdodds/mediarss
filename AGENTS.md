Default to using Node.js and npm.

## Linting

Always run `npm run lint` before you're done working to fix any lint issues.

## Formatting

Always run `npm run format` before you're done working to fix any formatting
issues.

## Commit Gate

Always run the full gate before committing:

`npm run validate`

Do not commit if any part of the gate fails.

## Remix Skill

Use the repo-local Remix skill at `.agents/skills/remix/SKILL.md` for Remix 3
package guidance and package-specific reference material. Load the skill before
changing Remix routes, controllers, middleware, data access, validation, auth,
sessions, file uploads, server setup, UI components, hydration, navigation, or
tests.

The upstream Remix CLI README still mentions `remix skills install`, but the
`remix@3.0.0-beta.0` CLI no longer exposes that command; this repo keeps the
shipped skill files checked in instead.

## No React

This application does NOT use React. We use `remix/ui` for UI components. Do not
introduce React, Preact, or any other UI framework.

## Node.js

- Use `node` for runtime execution and `npm` for package management.
- Use `npm install` to add dependencies and update `package-lock.json`.
- Use `npm run <script>` for project scripts.
- Use `process.env` for environment variables.

## Build

There is no build step. This is shipped as-is. We use modern Node.js runtime
TypeScript support for `.ts` files, a small Node hook for `.tsx` loading, and
runtime bundling of the client-side code in `server/bundling.ts`.

## APIs

- Use the Node HTTP stack plus `remix/node-fetch-server` for the server
  entrypoint.
- Use `node:sqlite` for SQLite.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer Node's built-in `fs`, `fs/promises`, and web `File`/`Blob` APIs for
  file access.

## Testing

Use `npm test` to run tests.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
	expect(1).toBe(1);
});
```

### Manual Testing with Local Media

To test the application with sample media files, use the `local-test` directory:

```bash
npm run dev:test
```

This command:

- Sets `DATABASE_PATH=./data/test.db` (separate from production data)
- Sets `MEDIA_PATHS=audio:./local-test/1/audio,video:./local-test/1/video`
- Runs the dev server with watch mode

**Important:** Each media path name must be unique. Duplicate names are not
allowed and will cause a validation error at startup.

The `local-test/1` directory contains sample media files:

- `audio/` - Audiobook files (.m4b, .m4a, .mp3)
- `video/` - Video files (.mkv)

You can add your own test media files to `local-test/` - this directory is
gitignored.

## Frontend

We limit the number of frontend dependencies to the bare minimum. Each
`node_modules` package needs to be explicitly listed in the import map in the
`layout.tsx` file.

## Cursor Cloud specific instructions

### Runtime

This project requires **Node.js >= 24.12.0** (uses `node:sqlite` and
`registerHooks`). nvm is installed at `~/.nvm`; source it before running node
commands:

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

### Running the dev server

Use `npm run dev:test` for local development. It creates test SQLite databases
(`./data/test.db`, `./data/test-cache.db`) and points at
`./local-test/1/audio`. The `local-test/` directory is gitignored — create
sample `.mp3` files there with ffmpeg if none exist:

```bash
mkdir -p local-test/1/audio
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -metadata title="Test" local-test/1/audio/test.mp3 -y
```

The server listens on port **22050** by default.

### Key caveats

- There is **no build step**. TypeScript is loaded at runtime via esbuild hooks.
- The `--watch` flag in `npm run dev:test` triggers a full process restart on
  file change (Node's native watch mode), so newly installed packages are picked
  up automatically.
- SQLite migrations run automatically on startup; no manual migration step
  needed.
- `npm run validate` is the full CI gate (format check + lint + typecheck +
  tests). Run before committing.
