---
name: ship-pr
description:
  Shepherd a MediaRSS pull request to merged or parked with the Kody ship-pr
  tick. Use when a PR is ready to finish.
---

# Ship PR

Run Kody exports with the local CLI, pinned because it runs with shipping
credentials (bootstrap auth with `cliCredentialBootstrap` from the Kody MCP if
needed). Use the same pinned version for every export below:

```sh
npx @kodycodes/cli@1.31.10 execute --local \
  --code 'import run from "kody:@kentcdodds/ship-pr/tick"; export default (p) => run(p)' \
  --params '{"prUrl":"https://github.com/kentcdodds/mediarss/pull/<n>","risk":"<tier>","applySafeAutomations":true}'
```

## Risk tiers

| Tier   | What                                                                                                                                                                                    | Merge gate                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| low    | Docs, tests, tooling, CI, styling, admin UI copy                                                                                                                                        | CI green; agent merges                                                 |
| medium | Admin pages and `/admin/api/*`, data modules, new migrations, media scanning, RSS content that keeps URLs and GUIDs stable                                                              | CI green + CodeRabbit review handled + control CLI proof; agent merges |
| high   | OAuth and MCP auth (`app/oauth`, `app/mcp/auth.ts`, `/mcp`, `/.well-known/*`, `/admin/authorize`); public `/feed`, `/media`, `/art` routes, token handling, RSS GUIDs or enclosure URLs | Park for Kent                                                          |

Pick the highest tier any changed file reaches; the
[Feature Map](../control-mediarss/references/feature-map.md) marks high routes.
Also read [docs/decisions](../../../docs/decisions/README.md): a PR that goes
against one is high.

## Loop

1. Fill the PR template, including Risk in the System recap.
2. Prove the change before review settles: `npm run validate`, then the control
   CLI against `dev` (`request --contains`, `execute`, `browse --record` for
   UI). Cite the commands under Testing. Required for medium.
3. Tick. Do the one thing its focus step asks: fix CI, address review threads
   (fix and reply with the commit, or `decide` with a reason; answer every
   "unsure" thread), resolve conflicts, mark ready, or wait `pollAfterSeconds`.
   Scrutinize every changed test expectation against the intent.
4. Repeat until the tick says merge, parked, or done.
5. Merge low or medium with `kody:@kentcdodds/ship-pr/merge`
   (`{ prUrl, risk, mergeMethod: 'squash' }`). High: stop, leave the PR open,
   and say why in the summary.
6. After merge, confirm the image published for the merge commit, then record
   the deploy step:
   `npm run --silent control -- health --published --sha <merge-sha> --wait 900`
   and `kody:@kentcdodds/ship-pr/decide` with
   `{ kind: 'step', target: 'deploy', disposition: 'accepted', reason: 'Docker Hub has sha-<sha>' }`.
7. File friction you hit (search open issues first) with
   `kody:@kentcdodds/friction-log/file` and
   `target: { host: 'github', repo: 'kentcdodds/mediarss' }`, plus `Cleanup:`
   issues for leftovers. Give each a priority label (`P0`-`P3`) and
   `needs-decision` when it needs Kent
   ([triage](../../../docs/contributing.md#issues-and-triage)). Nothing
   qualified? Record the `friction` step as `skipped` with `decide`.
8. Post the summary with `kody:@kentcdodds/ship-pr/send-summary` (Cursor agents
   pass `agentId`; others pass `agent`). It marks the report step done.
