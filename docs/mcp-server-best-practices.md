# MCP server

How MediaRSS's MCP server is built. Change `app/mcp/` to match these
conventions.

The server accepts Streamable HTTP revision `2026-07-28` only
(`createMcpHandler` from `@modelcontextprotocol/server`). Clients authenticate
with OAuth (PKCE); tools, resources, and prompts are registered from the
caller's scopes.

## Layout

| Path                              | Owns                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `app/mcp/metadata.ts`             | Server instructions and tool/prompt names, titles, descriptions |
| `app/mcp/tools.ts`                | Feed, browse, search, token, and assignment tools               |
| `app/mcp/media-metadata-tools.ts` | `get_media_metadata` / `update_media_metadata`                  |
| `app/mcp/resources.ts`            | `media://` resources and widget URIs                            |
| `app/mcp/widgets.ts`              | MCP-UI media player widget HTML                                 |
| `app/mcp/prompts.ts`              | Task-oriented conversation starters                             |
| `app/mcp/server.ts`               | `McpServer` setup and scoped initialization                     |
| `app/mcp/auth.ts`                 | Bearer verification and `mcp:read` / `mcp:write`                |
| `app/mcp/cors.ts`                 | CORS for `/mcp` and discovery                                   |
| `app/mcp/protocol-headers.ts`     | Required `MCP-Protocol-Version` check before dispatch           |
| `app/routes/mcp/`                 | `/mcp` and `/.well-known/oauth-protected-resource/mcp`          |
| `app/oauth/`                      | Authorization codes, PKCE, tokens, refresh, signing keys        |

Consent is `/admin/authorize` (behind Cloudflare Access with the rest of admin).
Discovery is public: `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`.

## Scopes

| Scope       | Access                                                                |
| ----------- | --------------------------------------------------------------------- |
| `mcp:read`  | List and inspect feeds, media, tokens, and metadata                   |
| `mcp:write` | Create, update, and delete feeds and tokens; assign media; write tags |

## Metadata

`app/mcp/metadata.ts` is the single source of truth for names, titles, and
descriptions. `serverMetadata.instructions` is the onboarding text the client
reads first: what to call first, how to chain IDs, default behavior, and
supported vs unsupported search.

Tool descriptions include:

1. What the tool does (one or two sentences)
2. Inputs, with examples and valid values
3. Returns (shape of the response)
4. Concrete examples
5. Next steps (which tool to call with which ID)

Keep copy in `metadata.ts`. Handlers in `tools.ts` stay about behavior.

## Tools

Register with `server.registerTool()` so each tool has a title, description, Zod
`inputSchema`, and annotations:

```ts
server.registerTool(
	'list_feeds',
	{
		title: 'List Feeds',
		description: getToolMetadata('list_feeds').description,
		inputSchema: {
			/* zod fields with .describe() */
		},
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		},
	},
	handler,
)
```

| Annotation        | `true` when                           |
| ----------------- | ------------------------------------- |
| `readOnlyHint`    | The tool does not change data         |
| `destructiveHint` | The change cannot be undone (deletes) |
| `idempotentHint`  | The same input is safe to repeat      |
| `openWorldHint`   | The tool reaches outside the process  |

Names are `snake_case`. Use `list_*` / `search_*` / `browse_*` for collections,
`get_*` for one record, `create_*` / `update_*` / `delete_*` for writes. Zod
field `.describe()` calls name defaults, formats, and valid values.

### Responses

Return both human-readable markdown in `content` and a typed object in
`structuredContent`. The text names the feed or file, links where they help, and
says what to do next.

On failure, say what went wrong, how to fix it, and which tool to call
(`isError: true`). Example:
`Feed "…" not found. Next: Use list_feeds to see available feeds.`

### Catalog

| Tool                      | Scope       | Role                                      |
| ------------------------- | ----------- | ----------------------------------------- |
| `list_feeds`              | `mcp:read`  | All feeds                                 |
| `get_feed`                | `mcp:read`  | One feed and its items                    |
| `list_media_directories`  | `mcp:read`  | Configured media roots                    |
| `browse_media`            | `mcp:read`  | Files in a media root                     |
| `search_media`            | `mcp:read`  | Fuzzy search (match-sorter, not semantic) |
| `get_feed_tokens`         | `mcp:read`  | Tokens and `/feed/{token}` URLs           |
| `get_media_widget`        | `mcp:read`  | Interactive player widget                 |
| `get_media_metadata`      | `mcp:read`  | Tags for one file                         |
| `create_directory_feed`   | `mcp:write` | Feed from a folder                        |
| `create_curated_feed`     | `mcp:write` | Manually selected items                   |
| `update_feed`             | `mcp:write` | Title, description, and related fields    |
| `delete_feed`             | `mcp:write` | Remove a feed                             |
| `create_feed_token`       | `mcp:write` | New access token (optional `label`)       |
| `delete_feed_token`       | `mcp:write` | Revoke a token                            |
| `add_media_to_feeds`      | `mcp:write` | Assign files to curated feeds             |
| `remove_media_from_feeds` | `mcp:write` | Unassign files                            |
| `update_media_metadata`   | `mcp:write` | Write tags into a file (ffmpeg)           |

`get_feed_tokens` and `create_feed_token` return `rssUrl` as `/feed/{token}`.
`/feed/{feedId}?token={token}` is not a route.

List tools return the full set. There is no cursor pagination.

## Resources

Registered from `mcp:read`.

JSON under `media://`:

- `media://server` — version, counts, media roots
- `media://feeds` — every feed
- `media://feeds/{id}` — one feed and its curated items
- `media://directories` — configured media roots

HTML widgets:

- `media://widget/media/{token}/{rootName}/{relativePath+}` — MCP-UI player
  (needs a valid feed token)
- `ui://widget/media-player-{hash}.html` — Apps SDK template from
  `getMediaWidgetUIUri()` (`text/html+skybridge`; the hash changes when the
  widget module graph changes)

HTTP player media is `/mcp/widget/:token/*path`.

## Prompts

Prompts start multi-step work and name the tools to use next:

| Prompt               | Scope       | Role                               |
| -------------------- | ----------- | ---------------------------------- |
| `summarize_library`  | `mcp:read`  | Library overview                   |
| `explore_feed`       | `mcp:read`  | Inspect one feed                   |
| `create_feed_wizard` | `mcp:write` | Create a directory or curated feed |
| `organize_media`     | `mcp:write` | Propose feeds from a root          |
