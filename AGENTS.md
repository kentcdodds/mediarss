# MediaRSS agent index

MediaRSS turns folders of audio (and some video) into private RSS feeds for
podcast apps. It is a self-hosted Docker app Kent runs on his NAS; feeds and
media are public by token, and the admin UI sits behind Cloudflare Access.
Node.js + npm, Remix 3 (`remix/component`, no React), SQLite via
`remix/data-table`.

`npm run validate` is the single local gate. CI runs that command, then Control
CLI smoke + Playwright, then a Docker image build and `/health` smoke. Git hooks
(installed by `npm install`) run format and lint on commit and typecheck on
push. Run `npm run check` to auto-fix format and lint before you finish.

This file is a map. Open the page that owns the task:

- Self-hosting, env vars, and Cloudflare Access: [README.md](README.md)
- Contributing, tooling, data layer, testing, triage:
  [docs/contributing.md](docs/contributing.md)
- Primitives and code roots: [docs/primitives.md](docs/primitives.md)
- Decisions (read before proposing big changes):
  [docs/decisions/](docs/decisions/README.md)
- Remix 3 APIs: [.agents/skills/remix/SKILL.md](.agents/skills/remix/SKILL.md)
  (load it before touching routes, middleware, data, UI, or tests)
- Running and proving a change:
  [.agents/skills/control-mediarss/SKILL.md](.agents/skills/control-mediarss/SKILL.md)
  and its
  [Feature Map](.agents/skills/control-mediarss/references/feature-map.md)
- Shipping a PR:
  [.agents/skills/ship-pr/SKILL.md](.agents/skills/ship-pr/SKILL.md)
- Rolling back a bad release:
  [docs/runbooks/rollback.md](docs/runbooks/rollback.md)
- MCP server conventions:
  [docs/mcp-server-best-practices.md](docs/mcp-server-best-practices.md)
