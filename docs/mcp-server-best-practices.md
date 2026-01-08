# MCP Server Best Practices

*Learnings from analyzing high-quality MCP server implementations*

This document summarizes best practices learned from analyzing the following MCP server implementations:
- [Linear MCP Server](https://github.com/iceener/linear-streamable-mcp-server)
- [Google Calendar MCP Server](https://github.com/iceener/google-calendar-streamable-mcp-server)
- [Google Maps MCP Server](https://github.com/iceener/maps-streamable-mcp-server)
- [Tesla MCP Server](https://github.com/iceener/tesla-streamable-mcp-server)

---

## 1. Server Instructions

### What Great Servers Do

Provide comprehensive server-level instructions that act as an "onboarding guide" for the AI. This is the first thing the AI reads when connecting.

**Best Practice Format:**
```
Quick start
- What to call first
- Most common workflows
- How to chain tools

Default behavior
- What happens when optional params are omitted
- Timezone handling
- Date format expectations

How to chain tools safely
- Which IDs come from which tools
- Dependency order
- Verification patterns

Common patterns & examples
- "To do X, first call Y, then Z"
```

**Example from Linear:**
```
Quick start
- Call 'workspace_metadata' first to fetch canonical identifiers you will reuse across tools.
- Then use 'list_issues' with teamId/projectId and filters to locate targets.
- To modify, use 'update_issues', then verify with 'list_issues'.
```

**Our Current State:** Minimal instructions (just capability descriptions)

---

## 2. Tool Descriptions

### What Great Servers Do

Tools have *detailed, structured descriptions* that include:

1. **What the tool does** (1-2 sentences)
2. **Inputs** with examples and valid values
3. **Returns** - what the response structure looks like
4. **Next steps** - what to do after calling this tool
5. **Examples** - concrete usage examples

**Best Practice Format:**
```
Brief description of what the tool does.

Inputs:
- param1: type (required/optional) — description with examples
- param2: type — description

Returns: { field1, field2, ... }

Examples:
- "Do X" → { param: "value" }
- "Do Y" → { param: "other" }

Next: Use tool_a to verify. Pass id to tool_b.
```

**Example from Google Calendar:**
```
Search events across ALL calendars by default. Returns merged results sorted by start time.

Inputs: calendarId? (default: 'all'), timeMin?, timeMax? (ISO 8601), query?, maxResults?...

FILTERING BY TIME (important!):
- Today's events: timeMin=start of day, timeMax=end of day
- This week: timeMin=Monday 00:00, timeMax=Sunday 23:59:59

Returns: { items: Array<{ id, summary, start, end, calendarId, calendarName... }> }

Next: Use eventId AND calendarId with 'update_event' or 'delete_event'.
```

**Our Current State:** Brief descriptions, no examples or chaining hints

---

## 3. Tool Annotations

### What Great Servers Do

Every tool includes annotations that help the AI understand the tool's behavior:

```typescript
annotations: {
  readOnlyHint: true,      // Does not modify state
  destructiveHint: false,  // Does not delete data
  idempotentHint: true,    // Safe to call multiple times
  openWorldHint: true,     // May access external resources
}
```

**Guidelines:**
| Annotation | When to use `true` |
|------------|-------------------|
| `readOnlyHint` | GET/LIST operations |
| `destructiveHint` | DELETE operations, irreversible changes |
| `idempotentHint` | Same input always produces same result |
| `openWorldHint` | Accesses external APIs/resources |

**Our Current State:** No annotations on tools

---

## 4. Input Schema Best Practices

### What Great Servers Do

Rich, descriptive input schemas with:

- **Clear descriptions** for each parameter
- **Default values** explained in description
- **Valid values** listed (especially for enums)
- **Format expectations** (dates, IDs, etc.)

**Example:**
```typescript
z.object({
  calendarId: z
    .union([z.literal('all'), z.string(), z.array(z.string())])
    .optional()
    .default('all')
    .describe('Calendar ID(s). Use "all" (default) to search all calendars, a single ID, or array of IDs'),
  
  timeMin: z
    .string()
    .optional()
    .describe('Start of time range (RFC3339 with timezone, e.g., 2025-12-06T19:00:00Z)'),
  
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(250)
    .optional()
    .default(50)
    .describe('Max events to return (1-250, default: 50)'),
})
```

**Our Current State:** Basic descriptions, missing defaults and format hints

---

## 5. Response Formatting

### What Great Servers Do

Return **both** human-readable text AND structured content:

```typescript
return {
  content: [{ 
    type: 'text', 
    text: `✓ Event created: [${title}](${htmlLink})\n  when: ${start}\n  meet: ${meetLink}` 
  }],
  structuredContent: {
    id: event.id,
    summary: event.summary,
    // ... full structured data
  },
}
```

**Human-readable text best practices:**
- Use **markdown** formatting (links, bold, lists)
- Use **emojis** for status (✓, ⚠️, 🟢, 🔴)
- Include **context** (what calendar, which feed)
- Provide **next steps** in the text

**Example from Tesla:**
```
## Model 3

**Status**: asleep
**Locked**: Yes ✓
**Sentry Mode**: On

### Battery
- Level: 78%
- Range: 312 km
- Charging: Not charging

### ⚠️ Open
- Trunk
```

**Our Current State:** JSON only, no human-readable formatting

---

## 6. Centralized Metadata

### What Great Servers Do

Keep tool/prompt/resource metadata in a centralized file:

```typescript
// config/metadata.ts
export const serverMetadata = {
  title: 'Media Server',
  instructions: `...comprehensive instructions...`,
}

export const toolsMetadata = {
  list_feeds: {
    name: 'list_feeds',
    title: 'List Feeds',
    description: '...detailed description...',
  },
  // ... more tools
}
```

**Benefits:**
- Single source of truth for descriptions
- Easy to review/update all metadata
- Consistent naming and style
- Can be extracted for documentation

**Our Current State:** Descriptions inline with tool definitions

---

## 7. Tool Naming Conventions

### What Great Servers Do

| Pattern | Example | Use Case |
|---------|---------|----------|
| `list_*` | `list_feeds`, `list_users` | Get multiple items |
| `get_*` | `get_feed`, `get_issue` | Get single item by ID |
| `create_*` | `create_feed` | Create new item |
| `update_*` | `update_feed` | Modify existing item |
| `delete_*` | `delete_feed` | Remove item |
| `browse_*` | `browse_media` | Navigate/explore |
| `search_*` | `search_events` | Query with filters |

**Consistency rules:**
- Use `snake_case` for tool names
- Group related tools with common prefix
- Use singular nouns for get/create, plural for list

**Our Current State:** Good naming, but some inconsistency

---

## 8. Error Handling

### What Great Servers Do

Provide helpful, actionable error messages:

```typescript
if (!feed) {
  return {
    content: [{
      type: 'text',
      text: `Feed "${feedId}" not found.\n\nNext: Use list_feeds to see available feeds.`,
    }],
    isError: true,
  }
}
```

**Best practices:**
- Explain **what went wrong**
- Suggest **how to fix it**
- Reference **related tools** that can help
- Include **valid values** when applicable

**Our Current State:** Basic error messages, no suggestions

---

## 9. Pagination & Limiting

### What Great Servers Do

Consistent pagination patterns:

```typescript
return {
  content: [...],
  structuredContent: {
    items: [...],
    pagination: {
      hasMore: boolean,
      nextCursor: string | undefined,
      itemsReturned: number,
      limit: number,
    },
  },
}
```

**In descriptions:**
```
Returns: { items[], pagination: { hasMore, nextCursor } }

Pass nextCursor to fetch the next page.
```

**Our Current State:** No pagination support

---

## 10. Resources Best Practices

### What Great Servers Do

Resources provide **read-only data access** with:
- Clear URI schemes (`media://feeds`, `media://feeds/{id}`)
- Proper MIME types
- Descriptions that explain the data structure

**Good resource examples:**
- `media://server` — Server info and statistics
- `media://feeds` — All feeds list
- `media://feeds/{id}` — Individual feed details
- `media://directories` — Available media directories

**Our Current State:** Good resource structure

---

## 11. Prompts Best Practices

### What Great Servers Do

Prompts are **task-oriented conversation starters**:

- Guide the user through **multi-step workflows**
- Provide **context** about available tools
- Include **concrete next steps**
- Support **optional parameters** to customize the task

**Example prompt:**
```
I want to create a new feed. Please help me decide:

1. Should this be a directory feed (automatically includes all media from a folder)?
2. Or a curated feed (manually select specific content)?

Available media roots:
- audio: /media/audio
- video: /media/video

Please ask me some questions to understand what I'm trying to create, then help me set it up.
```

**Our Current State:** Good prompt structure

---

## Summary: Action Items for Our MCP Server

### High Priority
1. ✅ Add comprehensive server instructions
2. ✅ Enhance tool descriptions with examples, inputs, returns, next steps
3. ✅ Add tool annotations (readOnlyHint, destructiveHint, etc.)
4. ✅ Improve response formatting (human-readable + structured)

### Medium Priority
5. ✅ Create centralized metadata file
6. ✅ Add helpful error messages with suggestions
7. ✅ Enhance input schema descriptions

### Lower Priority
8. Consider adding pagination support
9. Review naming consistency
