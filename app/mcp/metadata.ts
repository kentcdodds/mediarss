/**
 * Centralized metadata for the MCP server.
 * Single source of truth for all tool, prompt, and resource descriptions.
 */

export interface ToolMetadata {
	name: string
	title: string
	description: string
}

export interface PromptMetadata {
	name: string
	title: string
	description: string
}

/**
 * Server-level metadata including comprehensive instructions.
 */
export const serverMetadata = {
	name: 'media-server',
	version: '1.0.0',
	title: 'Media Server',
	instructions: `Use these tools to manage podcasts, audiobooks, and video content as RSS feeds.

## Quick Start

1. **Discover your library**: Call \`list_media_directories\` first to see available media roots.
2. **Search for content**: Use \`search_media\` to find specific files by title, author, etc.
3. **Browse content**: Use \`browse_media\` to explore directories and find content.
4. **List feeds**: Use \`list_feeds\` to see existing podcast/media feeds.
5. **Create feeds**: Use \`create_directory_feed\` or \`create_curated_feed\` to create new feeds.
6. **Share feeds**: Use \`get_feed_tokens\` to get RSS feed URLs for podcast apps.
7. **Play media**: Use \`get_media_widget\` to get an interactive media player widget.

## Searching Media

The \`search_media\` tool uses fuzzy string matching (match-sorter), NOT natural language or semantic search.

**How it works:**
- Matches words in any order: "mistborn sanderson" matches "Brandon Sanderson - Mistborn"
- Case insensitive matching
- Matches partial words: "mist" matches "Mistborn"
- Searches across: title, author, album, series, filename, narrators, genres, description

**Good queries:**
- Exact terms: "Mistborn", "Brandon Sanderson"
- Partial words: "storm" for "Stormlight"
- Combined terms: "sanderson stormlight"
- File extensions: ".m4b", ".mp3"

**Not supported:**
- Natural language: "find fantasy audiobooks" won't work
- Semantic meaning: "books about magic" won't find fantasy books

## Feed Types

- **Directory Feed**: Automatically includes all media files from a folder. Great for audiobook series, TV shows, or any organized media collection.
- **Curated Feed**: Manually select specific files from anywhere. Great for playlists or custom collections.

## Common Workflows

### Create a podcast feed from a folder:
1. \`list_media_directories\` → find the media root name
2. \`browse_media\` → navigate to the folder
3. \`create_directory_feed\` → create the feed
4. Feed URL: \`/feed/{feedId}?token={token}\`

### Manage feed access:
1. \`get_feed_tokens\` → list existing tokens
2. \`create_feed_token\` → generate new access token
3. \`delete_feed_token\` → revoke access

## Authorization Scopes

Your capabilities depend on your authorization scopes:
- **mcp:read**: Browse media, list feeds, view feed details and tokens
- **mcp:write**: Create/update/delete feeds, manage tokens

## Tool Chaining

- **feedId**: Get from \`list_feeds\` or \`get_feed\`, use with all feed operations
- **mediaRoot**: Get from \`list_media_directories\`, use with \`browse_media\` and \`create_directory_feed\`
- **token**: Get from feed creation or \`get_feed_tokens\`, use for RSS feed URLs
`,
} as const

/**
 * Tool metadata - descriptions, examples, and usage hints.
 */
export const toolsMetadata = {
	// Read tools
	list_feeds: {
		name: 'list_feeds',
		title: 'List Feeds',
		description: `List all available podcast and media feeds.

Returns: Array of feeds with { id, name, description, type, createdAt }

Types:
- \`directory\`: Auto-includes all media from a folder
- \`curated\`: Manually selected media files

Next: Use feed id with \`get_feed\` for details, or \`get_feed_tokens\` for RSS URLs.

Example response:
- "Audiobooks" (directory) - Created 2024-01-15
- "Favorites" (curated) - Created 2024-02-01`,
	},

	get_feed: {
		name: 'get_feed',
		title: 'Get Feed Details',
		description: `Get details about a specific feed including its items.

Inputs:
- id: string (required) — The feed ID from \`list_feeds\`

Returns: { feed: { id, name, description, type, createdAt }, items: [...], itemCount }

For curated feeds, items shows all added media files with their paths.
For directory feeds, items are dynamically loaded from the folder.

Next: Use with \`update_feed\` to modify, or \`get_feed_tokens\` for RSS URLs.`,
	},

	list_media_directories: {
		name: 'list_media_directories',
		title: 'List Media Directories',
		description: `List configured media directories that can be browsed.

Returns: Array of { name, path } for each media root.

Media roots are the top-level directories configured by the server admin.
Use the \`name\` value with \`browse_media\` and \`create_directory_feed\`.

Next: Use \`browse_media\` with a media root name to explore contents.

Example response:
- audio: /mnt/media/audiobooks
- video: /mnt/media/videos`,
	},

	browse_media: {
		name: 'browse_media',
		title: 'Browse Media Directory',
		description: `Browse files and folders in a media directory.

Inputs:
- mediaRoot: string (required) — Name from \`list_media_directories\`
- subPath: string (optional) — Subdirectory path to browse (default: root)

Returns: { path, mediaRoot, entries: [{ name, type: 'file'|'directory', size? }] }

Entries are sorted with directories first, then files alphabetically.
File sizes are in bytes.

Examples:
- Browse root: { mediaRoot: "audio" }
- Browse subfolder: { mediaRoot: "audio", subPath: "Brandon Sanderson/Mistborn" }

Next: Use paths with \`create_directory_feed\` to create feeds.`,
	},

	get_feed_tokens: {
		name: 'get_feed_tokens',
		title: 'Get Feed Tokens',
		description: `Get the access tokens for a feed (used in RSS URLs).

Inputs:
- feedId: string (required) — The feed ID

Returns: { feedId, feedName, tokens: [{ token, label, createdAt }] }

Feed URLs use the format: \`/feed/{feedId}?token={token}\`
Add this URL to any podcast app to subscribe to the feed.

Next: Use \`create_feed_token\` to generate additional tokens, or \`delete_feed_token\` to revoke access.`,
	},

	// Write tools
	create_directory_feed: {
		name: 'create_directory_feed',
		title: 'Create Directory Feed',
		description: `Create a new feed from a media directory.

Inputs:
- name: string (required) — Display name for the feed
- description: string (optional) — Description shown in podcast apps
- mediaRoot: string (required) — Name from \`list_media_directories\`
- directoryPath: string (required) — Path within the media root

Returns: { success, feed: { id, name, description }, token }

The feed will automatically include all media files in the directory.
A token is auto-generated for immediate use.

Examples:
- { name: "Mistborn Series", mediaRoot: "audio", directoryPath: "Brandon Sanderson/Mistborn" }
- { name: "Movies 2024", mediaRoot: "video", directoryPath: "Movies/2024", description: "Latest movies" }

Next: Feed URL is \`/feed/{feed.id}?token={token}\`. Use \`get_feed\` to verify.`,
	},

	create_curated_feed: {
		name: 'create_curated_feed',
		title: 'Create Curated Feed',
		description: `Create a new curated feed (manually managed).

Inputs:
- name: string (required) — Display name for the feed
- description: string (optional) — Description shown in podcast apps

Returns: { success, feed: { id, name, description }, token }

Curated feeds start empty. Add media files via the web UI or \`add_media_to_curated_feed\`.
A token is auto-generated for immediate use.

Examples:
- { name: "Favorites" }
- { name: "Road Trip Playlist", description: "Audiobooks for the drive" }

Next: Feed URL is \`/feed/{feed.id}?token={token}\`. Add items via \`add_media_to_curated_feed\` or the admin UI.`,
	},

	update_feed: {
		name: 'update_feed',
		title: 'Update Feed',
		description: `Update a feed's name or description.

Inputs:
- id: string (required) — The feed ID
- name: string (optional) — New name
- description: string (optional) — New description

Returns: { success, message }

Only provided fields are updated. Omit fields to keep current values.

Examples:
- Rename: { id: "abc123", name: "New Name" }
- Update description: { id: "abc123", description: "Updated description" }
- Both: { id: "abc123", name: "New Name", description: "New description" }

Next: Use \`get_feed\` to verify changes.`,
	},

	delete_feed: {
		name: 'delete_feed',
		title: 'Delete Feed',
		description: `Delete a feed and all its tokens.

Inputs:
- id: string (required) — The feed ID to delete

Returns: { success, message }

⚠️ This permanently removes the feed and invalidates all access tokens.
Media files are NOT deleted, only the feed configuration.

Next: Use \`list_feeds\` to verify deletion.`,
	},

	create_feed_token: {
		name: 'create_feed_token',
		title: 'Create Feed Token',
		description: `Create a new access token for a feed.

Inputs:
- feedId: string (required) — The feed ID

Returns: { success, feedId, token }

Each token creates a unique RSS URL: \`/feed/{feedId}?token={token}\`
Use multiple tokens to track or revoke access per device/user.

Next: Share the feed URL with the new token.`,
	},

	delete_feed_token: {
		name: 'delete_feed_token',
		title: 'Delete Feed Token',
		description: `Delete an access token for a feed (revokes access).

Inputs:
- token: string (required) — The token to delete

Returns: { success, message }

⚠️ This immediately invalidates the token. Anyone using this token will lose access.
The feed and other tokens are not affected.

Next: Use \`get_feed_tokens\` to verify deletion or \`create_feed_token\` to issue a replacement.`,
	},

	get_media_widget: {
		name: 'get_media_widget',
		title: 'Get Media Widget',
		description: `Get an interactive media player widget for a specific media file.

Inputs:
- token: string (required) — A feed access token (from \`get_feed_tokens\`)
- mediaRoot: string (required) — Name of the media root (from \`list_media_directories\`)
- relativePath: string (required) — Path to the media file within the root

Returns: { widgetUri, metadata: { title, author, duration, mimeType, ... } }

The widgetUri can be fetched as a resource to get an HTML media player widget.
The metadata includes all available information about the media file.

Prerequisites:
1. Get a feed token using \`get_feed_tokens\` for the feed containing the media
2. The media file must be accessible via the token's feed

Examples:
- { token: "abc123", mediaRoot: "audio", relativePath: "Brandon Sanderson/Mistborn/01.m4b" }

Next: Fetch the widgetUri as a resource to get the interactive HTML player widget.`,
	},

	add_media_to_curated_feed: {
		name: 'add_media_to_curated_feed',
		title: 'Add Media to Curated Feed',
		description: `Add a media file to a curated feed.

Inputs:
- feedId: string (required) — The curated feed ID (from \`list_feeds\`)
- mediaRoot: string (required) — Name of the media root (from \`list_media_directories\`)
- relativePath: string (required) — Path to the media file within the root
- position: number (optional) — Position in the feed (0-indexed non-negative integer, appended if omitted)

Returns: {
  success,
  feedItem: { id, mediaRoot, relativePath, position, addedAt },
  feed: { id, name }
}

The media file must exist and be accessible within the media root.
Only works with curated feeds (not directory feeds).
Paths are normalized to prevent duplicates (e.g., \`foo//bar\` becomes \`foo/bar\`).

Examples:
- { feedId: "abc123", mediaRoot: "audio", relativePath: "Brandon Sanderson/Mistborn/01.m4b" }
- { feedId: "abc123", mediaRoot: "audio", relativePath: "audiobook.m4b", position: 0 }

Next: Use \`get_feed\` to see the updated feed contents.`,
	},

	search_media: {
		name: 'search_media',
		title: 'Search Media',
		description: `Search for media files using fuzzy string matching.

**Important**: This is NOT a natural language or semantic search. It uses match-sorter for fuzzy string matching against media metadata fields. The search query is matched against text fields like title, author, filename, etc.

Inputs:
- query: string (required) — The search query to match against media metadata
- limit: number (optional) — Maximum results to return (default: 20, max: 100)

Returns: {
  query,
  results: [{
    mediaRoot,
    relativePath,
    title,
    author,
    duration,
    mimeType,
    album,
    series,
    ...
  }],
  total,
  truncated
}

Searchable fields (in priority order):
1. title — Media title from metadata
2. author — Author/artist name
3. album — Album name
4. series — Series name
5. filename — Original filename
6. narrators — Narrator names (for audiobooks)
7. genres — Genre tags
8. description — Media description
9. composer, publisher, albumArtist

How match-sorter works:
- Matches words in any order: "mistborn sanderson" matches "Brandon Sanderson - Mistborn"
- Case insensitive: "MISTBORN" matches "Mistborn"
- Matches acronyms: "bfab" matches "Brandon (F)andoms (A)re (B)est"
- Matches partial words: "mist" matches "Mistborn"
- Ranks by match quality: exact matches > word starts > contains

Examples:
- { query: "mistborn" } — Find files with "mistborn" in title, author, etc.
- { query: "sanderson stormlight" } — Find Stormlight Archive by Brandon Sanderson
- { query: "narrated by kramer" } — Find audiobooks narrated by Michael Kramer
- { query: ".m4b" } — Find all M4B audiobook files

Next: Use results with \`add_media_to_curated_feed\` or \`get_media_widget\`.`,
	},
} as const satisfies Record<string, ToolMetadata>

/**
 * Prompt metadata - task-oriented conversation starters.
 */
export const promptsMetadata = {
	summarize_library: {
		name: 'summarize_library',
		title: 'Summarize Library',
		description:
			'Get a summary of your media library including feeds and directories',
	},

	explore_feed: {
		name: 'explore_feed',
		title: 'Explore Feed',
		description: 'Explore a specific feed and its contents',
	},

	create_feed_wizard: {
		name: 'create_feed_wizard',
		title: 'Create Feed Wizard',
		description: 'Interactive wizard to create a new feed step by step',
	},

	organize_media: {
		name: 'organize_media',
		title: 'Organize Media',
		description: 'Help organize media files into logical feeds',
	},
} as const satisfies Record<string, PromptMetadata>

/**
 * Type-safe helper to get tool metadata.
 */
export function getToolMetadata(
	toolName: keyof typeof toolsMetadata,
): ToolMetadata {
	return toolsMetadata[toolName]
}

/**
 * Type-safe helper to get prompt metadata.
 */
export function getPromptMetadata(
	promptName: keyof typeof promptsMetadata,
): PromptMetadata {
	return promptsMetadata[promptName]
}
