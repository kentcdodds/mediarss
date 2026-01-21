# MCP Server Implementation Plan

This document outlines the plan for implementing a Model Context Protocol (MCP) server in this project, based on the [MCP Authorization specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and insights from the [MCP Auth workshop](https://github.com/epicweb-dev/mcp-auth).

## Implementation Status

✅ **Implementation Complete**

The MCP server has been implemented with the following components:

### Files Created

| File | Description |
|------|-------------|
| `app/mcp/auth.ts` | Authentication utilities - token validation, scope checking, 401/403 responses |
| `app/mcp/cors.ts` | CORS handling for MCP and discovery endpoints |
| `app/mcp/transport.ts` | Bun-compatible Streamable HTTP transport (adapted from MCP SDK) |
| `app/mcp/server.ts` | McpServer setup and initialization |
| `app/mcp/tools.ts` | MCP tools - list_feeds, get_feed, browse_media, create_feed, etc. |
| `app/mcp/resources.ts` | MCP resources - feeds, media directories, server info |
| `app/mcp/prompts.ts` | MCP prompts - summarize_library, explore_feed, create_feed_wizard, organize_media |
| `app/routes/mcp/index.ts` | Main `/mcp` endpoint handler |
| `app/routes/mcp/oauth-protected-resource.ts` | Discovery endpoint handler |

### Routes Added

- `GET/POST/DELETE /mcp` - Main MCP endpoint (Streamable HTTP transport)
- `GET /.well-known/oauth-protected-resource/mcp` - Protected resource metadata discovery

### Dependencies Added

- `@modelcontextprotocol/sdk` - MCP TypeScript SDK

### Available MCP Tools

| Tool | Scope Required | Description |
|------|---------------|-------------|
| `list_feeds` | `mcp:read` | List all feeds |
| `get_feed` | `mcp:read` | Get feed details |
| `list_media_directories` | `mcp:read` | List configured media roots |
| `browse_media` | `mcp:read` | Browse files in a media directory |
| `get_feed_tokens` | `mcp:read` | Get access tokens for a feed |
| `create_directory_feed` | `mcp:write` | Create a feed from a directory |
| `create_curated_feed` | `mcp:write` | Create a manually managed feed |
| `update_feed` | `mcp:write` | Update feed title/description |
| `delete_feed` | `mcp:write` | Delete a feed |
| `create_feed_token` | `mcp:write` | Create a new feed access token |
| `delete_feed_token` | `mcp:write` | Delete a feed access token |

### Supported Scopes

- `mcp:read` - Read-only access to feeds and media
- `mcp:write` - Create/modify feeds and media assignments

---

## Overview

The MCP server will:
- Be accessible at `/mcp` route
- Use our existing OAuth 2.0 authorization server for authentication
- Provide tools, resources, and prompts for interacting with the media server
- Support the Streamable HTTP transport protocol

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              MCP Client                                   │
│                    (Claude Desktop, VS Code, etc.)                        │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Media Server                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                     Discovery Endpoints                              │ │
│  │  /.well-known/oauth-protected-resource/mcp                          │ │
│  │  /.well-known/oauth-authorization-server                            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                  │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                     MCP Endpoint (/mcp)                              │ │
│  │  - Token validation via JWT verification                            │ │
│  │  - Streamable HTTP transport                                        │ │
│  │  - Tools, Resources, Prompts                                        │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                  │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                  Existing OAuth Server                               │ │
│  │  - /admin/authorize                                                  │ │
│  │  - /oauth/token                                                      │ │
│  │  - /oauth/jwks                                                       │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Discovery Endpoints

#### 1.1 Protected Resource Metadata Endpoint

**File:** `app/routes/mcp/oauth-protected-resource.ts`

Create `/.well-known/oauth-protected-resource/mcp` endpoint that returns:

```json
{
  "resource": "https://example.com/mcp",
  "authorization_servers": ["https://example.com"],
  "scopes_supported": ["mcp:read", "mcp:write"]
}
```

This endpoint:
- Must have CORS headers allowing all origins
- Must support GET and HEAD methods
- Must return the URL of the authorization server

#### 1.2 Authorization Server Metadata (Backwards Compatibility)

The existing `/.well-known/oauth-authorization-server` endpoint already exists at `app/routes/oauth/server-metadata.ts`. No changes needed, but verify it includes:
- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`
- `response_types_supported`
- `grant_types_supported`
- `code_challenge_methods_supported`

### Phase 2: Authentication Layer

#### 2.1 Token Verification

**File:** `app/mcp/auth.ts`

Create authentication utilities:

```typescript
import { verifyAccessToken } from '#app/oauth/tokens.ts'

export interface AuthInfo {
  token: string
  scopes: string[]
  sub: string
}

export async function resolveAuthInfo(
  authHeader: string | null,
  issuer: string
): Promise<AuthInfo | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const payload = await verifyAccessToken(token, issuer)
  if (!payload) return null

  return {
    token,
    scopes: payload.scope.split(' '),
    sub: payload.sub,
  }
}
```

#### 2.2 Unauthorized Response Handler

```typescript
export function handleUnauthorized(request: Request): Response {
  const hasAuthHeader = request.headers.has('authorization')
  const url = new URL('/.well-known/oauth-protected-resource/mcp', request.url)

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': [
        `Bearer realm="MediaServer"`,
        hasAuthHeader ? `error="invalid_token"` : null,
        hasAuthHeader
          ? `error_description="The access token is invalid or expired"`
          : null,
        `resource_metadata=${url.toString()}`,
      ]
        .filter(Boolean)
        .join(', '),
    },
  })
}
```

### Phase 3: MCP Transport Adapter for Bun

The MCP SDK's `StreamableHTTPServerTransport` expects Node.js-style request/response objects. We need to create an adapter for Bun's native HTTP handling.

#### 3.1 Bun-Compatible Transport

**File:** `app/mcp/transport.ts`

Options for implementation:

**Option A: Node.js Compatibility Layer**
Use Bun's built-in Node.js compatibility to wrap requests/responses.

**Option B: Custom Bun Transport**
Create a new transport class based on `StreamableHTTPServerTransport` logic that works natively with Web API Request/Response.

**Option C: Fetch Handler Adapter**
Create an adapter that converts between Web API and Node.js stream interfaces.

Recommended approach: **Option B** - Create a `BunStreamableHTTPServerTransport` class that:
- Accepts Web API `Request` objects
- Returns Web API `Response` objects  
- Implements the same Streamable HTTP protocol
- Uses `ReadableStream` for SSE instead of Node.js streams

```typescript
export class BunStreamableHTTPServerTransport {
  private sessionId?: string
  private sessionIdGenerator?: () => string
  private initialized = false
  private streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()

  constructor(options: {
    sessionIdGenerator?: () => string
  }) {
    this.sessionIdGenerator = options.sessionIdGenerator
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    
    if (request.method === 'POST') {
      return this.handlePostRequest(request)
    } else if (request.method === 'GET') {
      return this.handleGetRequest(request)
    } else if (request.method === 'DELETE') {
      return this.handleDeleteRequest(request)
    }
    
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Allow': 'GET, POST, DELETE' }
    })
  }

  // ... implement POST/GET/DELETE handlers
}
```

### Phase 4: MCP Server Implementation

#### 4.1 Server Setup

**File:** `app/mcp/server.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { initializeTools } from './tools.ts'
import { initializeResources } from './resources.ts'
import { initializePrompts } from './prompts.ts'

export function createMcpServer() {
  const server = new McpServer(
    {
      name: 'media-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
        prompts: { listChanged: true },
        logging: {},
      },
      instructions: `
This is a media server MCP that allows you to manage podcasts, audiobooks,
and video content. You can browse media, manage feeds, and control playback.
      `.trim(),
    }
  )

  return server
}
```

#### 4.2 Tools Implementation

**File:** `app/mcp/tools.ts`

Initial tools to implement:

```typescript
import { z } from 'zod'

export async function initializeTools(server: McpServer, authInfo: AuthInfo) {
  // List all feeds
  server.registerTool(
    'list_feeds',
    {
      title: 'List Feeds',
      description: 'List all available podcast and media feeds',
      annotations: { readOnlyHint: true },
    },
    async () => {
      // Implementation
    }
  )

  // Get feed details
  server.registerTool(
    'get_feed',
    {
      title: 'Get Feed',
      description: 'Get details about a specific feed',
      inputSchema: { id: z.number() },
    },
    async ({ id }) => {
      // Implementation
    }
  )

  // Browse media directories
  server.registerTool(
    'browse_media',
    {
      title: 'Browse Media',
      description: 'Browse media files in a directory',
      inputSchema: {
        path: z.string().optional(),
        mediaPath: z.string(),
      },
    },
    async ({ path, mediaPath }) => {
      // Implementation
    }
  )

  // Create feed
  if (authInfo.scopes.includes('mcp:write')) {
    server.registerTool(
      'create_feed',
      {
        title: 'Create Feed',
        description: 'Create a new media feed',
        inputSchema: {
          title: z.string(),
          description: z.string().optional(),
          type: z.enum(['directory', 'curated']),
        },
      },
      async (input) => {
        // Implementation
      }
    )
  }
}
```

#### 4.3 Resources Implementation

**File:** `app/mcp/resources.ts`

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

export async function initializeResources(server: McpServer, authInfo: AuthInfo) {
  // Feed resource
  server.registerResource(
    'feed',
    new ResourceTemplate('media://feeds/{id}', {
      list: async () => {
        const feeds = await getFeeds()
        return {
          resources: feeds.map(feed => ({
            name: feed.title,
            uri: `media://feeds/${feed.id}`,
            mimeType: 'application/json',
          })),
        }
      },
    }),
    {
      title: 'Media Feed',
      description: 'A media feed containing podcast episodes or media items',
    },
    async (uri, { id }) => {
      const feed = await getFeed(Number(id))
      return {
        contents: [{
          mimeType: 'application/json',
          text: JSON.stringify(feed),
          uri: uri.toString(),
        }],
      }
    }
  )

  // Media item resource
  server.registerResource(
    'media-item',
    new ResourceTemplate('media://items/{feedId}/{itemId}', { /* ... */ }),
    { /* ... */ },
    async (uri, { feedId, itemId }) => { /* ... */ }
  )
}
```

#### 4.4 Prompts Implementation

**File:** `app/mcp/prompts.ts`

```typescript
export async function initializePrompts(server: McpServer) {
  server.registerPrompt(
    'organize_media',
    {
      title: 'Organize Media',
      description: 'Help organize and categorize media files',
      argsSchema: {
        directory: z.string().describe('The directory to organize'),
      },
    },
    async ({ directory }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please help me organize the media files in ${directory}. 
              Suggest a good folder structure and naming convention.`,
            },
          },
        ],
      }
    }
  )
}
```

### Phase 5: Route Integration

#### 5.1 MCP Route Handler

**File:** `app/routes/mcp/index.ts`

```typescript
import type { Action, RequestContext } from 'remix/fetch-router'
import { resolveAuthInfo, handleUnauthorized } from '#app/mcp/auth.ts'
import { createMcpServer } from '#app/mcp/server.ts'
import { BunStreamableHTTPServerTransport } from '#app/mcp/transport.ts'

// Session management
const sessions = new Map<string, {
  transport: BunStreamableHTTPServerTransport
  server: McpServer
}>()

async function handleRequest(context: RequestContext): Promise<Response> {
  const { request } = context
  const issuer = `${context.url.protocol}//${context.url.host}`

  // Validate authentication
  const authInfo = await resolveAuthInfo(
    request.headers.get('authorization'),
    issuer
  )

  if (!authInfo) {
    return handleUnauthorized(request)
  }

  // Get or create session
  const sessionId = request.headers.get('mcp-session-id')
  let session = sessionId ? sessions.get(sessionId) : null

  if (!session) {
    // Create new session
    const transport = new BunStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })
    const server = createMcpServer()
    await initializeTools(server, authInfo)
    await initializeResources(server, authInfo)
    await initializePrompts(server)
    await server.connect(transport)

    session = { transport, server }
    // Session will be stored after initialization
  }

  return session.transport.handleRequest(request)
}

export default {
  middleware: [],
  async action(context: RequestContext) {
    return handleRequest(context)
  },
}
```

#### 5.2 Update Router

**File:** `app/router.tsx`

Add the new routes:

```typescript
import mcpHandlers from '#app/routes/mcp/index.ts'
import mcpProtectedResourceHandlers from '#app/routes/mcp/oauth-protected-resource.ts'

// Add to routes config
// mcp: '/mcp',
// mcpProtectedResource: '/.well-known/oauth-protected-resource/mcp',

router.map(routes.mcpProtectedResource, mcpProtectedResourceHandlers)
router.map(routes.mcp, mcpHandlers)
```

### Phase 6: Scope Configuration

#### 6.1 Define MCP Scopes

Add MCP-specific scopes to the OAuth server:

```typescript
// Supported scopes for MCP
const MCP_SCOPES = [
  'mcp:read',   // Read-only access to feeds and media
  'mcp:write',  // Create/modify feeds and media assignments
] as const

type McpScope = typeof MCP_SCOPES[number]
```

#### 6.2 Update Authorization Flow

Modify the authorize endpoint to accept and validate MCP scopes when an MCP client initiates OAuth flow.

### Phase 7: CORS Configuration

**File:** `app/mcp/cors.ts`

```typescript
export function withMcpCors(handler: (req: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const response = await handler(request)

    // Add CORS headers to response
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
```

## File Structure

```
app/
├── mcp/
│   ├── auth.ts                 # Authentication utilities
│   ├── cors.ts                 # CORS handling
│   ├── prompts.ts              # MCP prompts
│   ├── resources.ts            # MCP resources
│   ├── server.ts               # McpServer setup
│   ├── tools.ts                # MCP tools
│   └── transport.ts            # Bun-compatible transport
├── routes/
│   └── mcp/
│       ├── index.ts            # Main /mcp endpoint
│       └── oauth-protected-resource.ts  # Discovery endpoint
```

## Dependencies

Add to package.json:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.24.3"
  }
}
```

## Testing Plan

### Manual Testing

1. **Discovery Test**
   ```bash
   curl http://localhost:3000/.well-known/oauth-protected-resource/mcp
   ```

2. **Auth Challenge Test**
   ```bash
   curl http://localhost:3000/mcp -H "Accept: application/json, text/event-stream"
   # Should return 401 with WWW-Authenticate header
   ```

3. **MCP Inspector**
   Use the MCP Inspector tool to test the full flow:
   ```bash
   bunx @modelcontextprotocol/inspector
   ```

### Integration Tests

Create test files:
- `app/mcp/auth.test.ts`
- `app/mcp/transport.test.ts`
- `app/routes/mcp/index.test.ts`

## Security Considerations

1. **Token Validation**: Always verify JWT tokens using our existing OAuth infrastructure
2. **Scope Checking**: Enforce scope requirements for write operations
3. **Session Management**: Implement proper session cleanup and timeout
4. **CORS**: Only allow necessary origins in production
5. **Rate Limiting**: Apply rate limiting to MCP endpoints

## Migration Notes

- The existing OAuth server already supports the necessary endpoints
- No database schema changes required initially
- MCP tools will interact with existing database tables

## Future Enhancements

1. **Token Introspection Endpoint**: Add `/oauth/introspection` for RFC 7662 compliance
2. **Refresh Tokens**: Implement refresh token flow for long-lived sessions  
3. **Additional Tools**: Add more tools based on user feedback
4. **Resource Subscriptions**: Implement real-time updates for subscribed resources
5. **Sampling**: Add sampling support for AI-assisted operations
