import { type routes } from '#app/routes.ts'

export type RouteName = keyof typeof routes

export type FeatureSurface =
	| 'page'
	| 'admin-api'
	| 'public'
	| 'oauth'
	| 'mcp'
	| 'ops'

export type FeatureNote = {
	surface: FeatureSurface
	/** What the route does, one line. */
	summary: string
	/** Methods the handler accepts when the route is mapped as ANY. */
	methods?: string
	/** How to get the data this route needs in the control environment. */
	seed?: string
	/** A control CLI command that reaches it. */
	reach: string
	/** Changes here always need Kent (see .agents/skills/ship-pr). */
	high?: true
}

const curatedFeedSeed =
	'`execute --code-file tools/control-fixtures/curated-feed.ts` creates a curated feed with fixture audio and prints its id and token'

export const featureNotes = {
	root: {
		surface: 'page',
		summary: 'Redirects to /admin',
		reach: 'request GET / --status 302',
	},
	health: {
		surface: 'ops',
		summary:
			'Public health snapshot: status, version, commit SHA, database, media roots',
		reach: 'health (or request GET /health --contains \'"status":"ok"\')',
	},
	feed: {
		surface: 'public',
		summary: 'RSS XML for a feed token; podcast apps subscribe to this URL',
		seed: curatedFeedSeed,
		reach: 'request GET /feed/<token> --contains "<rss"',
		high: true,
	},
	media: {
		surface: 'public',
		summary: 'Streams a media file (range requests) for a feed token',
		seed: curatedFeedSeed,
		reach: 'request GET /media/<token>/audio/Inkheart.m4b --status 200',
		high: true,
	},
	art: {
		surface: 'public',
		summary: 'Feed or item artwork for a feed token',
		seed: curatedFeedSeed,
		reach: 'request GET /art/<token>/audio/Inkheart.m4b --status 200',
		high: true,
	},
	oauthServerMetadata: {
		surface: 'oauth',
		summary: 'OAuth authorization server metadata for MCP clients',
		reach:
			'request GET /.well-known/oauth-authorization-server --contains token_endpoint',
		high: true,
	},
	mcpProtectedResource: {
		surface: 'oauth',
		summary: 'OAuth protected resource metadata for /mcp',
		reach:
			'request GET /.well-known/oauth-protected-resource/mcp --contains authorization_servers',
		high: true,
	},
	oauthToken: {
		surface: 'oauth',
		summary: 'Token endpoint (authorization code + PKCE, refresh)',
		methods: 'POST',
		seed: 'Needs a code from POST /admin/authorize; covered by app/routes/oauth tests',
		reach: 'request POST /oauth/token --status 400 (no body)',
		high: true,
	},
	oauthJwks: {
		surface: 'oauth',
		summary: 'Public signing keys',
		methods: 'GET',
		reach: 'request GET /oauth/jwks --contains keys',
		high: true,
	},
	oauthRegister: {
		surface: 'oauth',
		summary: 'Dynamic client registration',
		methods: 'POST',
		reach: "request POST /oauth/register --json-body '{}' --status 400",
		high: true,
	},
	mcp: {
		surface: 'mcp',
		summary: 'MCP server (streamable HTTP); requires an OAuth bearer token',
		methods: 'POST',
		reach: 'request POST /mcp --status 401 (no token)',
		high: true,
	},
	mcpWidget: {
		surface: 'mcp',
		summary: 'MCP UI widget media for a feed token',
		seed: curatedFeedSeed,
		reach: 'request GET /mcp/widget/<token>/audio/Inkheart.m4b',
		high: true,
	},
	adminHealth: {
		surface: 'ops',
		summary: 'Admin health snapshot (same data as /health)',
		reach: 'request GET /admin/health --contains status',
	},
	adminApiVersion: {
		surface: 'admin-api',
		summary: 'Version and commit info',
		reach: 'request GET /admin/api/version --contains commit',
	},
	adminAuthorize: {
		surface: 'oauth',
		summary: 'OAuth consent page (GET) and approval (POST) for MCP clients',
		methods: 'GET, POST',
		seed: 'Needs client_id, redirect_uri, code_challenge query params from a registered client',
		reach: 'browse --path "/admin/authorize?client_id=..." --record',
		high: true,
	},
	admin: {
		surface: 'page',
		summary: 'Dashboard: feed list',
		reach: 'browse --path /admin --wait-for "Your Feeds"',
	},
	adminFeedNew: {
		surface: 'page',
		summary: 'Create a directory or curated feed',
		reach: 'browse --path /admin/feeds/new --record',
	},
	adminFeedEdit: {
		surface: 'page',
		summary: 'Edit feed settings',
		seed: curatedFeedSeed,
		reach: 'browse --path /admin/feeds/<id>/edit --record',
	},
	adminFeed: {
		surface: 'page',
		summary: 'Feed details: items, tokens, analytics, artwork',
		seed: curatedFeedSeed,
		reach: 'browse --path /admin/feeds/<id> --record',
	},
	adminMedia: {
		surface: 'page',
		summary: 'Media library with search and sort (URL-synced)',
		reach:
			'browse --path "/admin/media?sort=title-az" --wait-for "Media Library"',
	},
	adminMediaEdit: {
		surface: 'page',
		summary: 'Edit a media file’s metadata (writes the file via ffmpeg)',
		seed: 'Fixture media is copied into data/control/<port>/media, so edits never touch test/fixtures',
		reach: 'browse --path /admin/media/audio/Inkheart.m4b/edit --record',
	},
	adminMediaDetail: {
		surface: 'page',
		summary: 'Media details: metadata, feed assignments, analytics',
		reach: 'browse --path /admin/media/audio/Inkheart.m4b --record',
	},
	adminVersion: {
		surface: 'page',
		summary: 'Version page',
		reach: 'browse --path /admin/version',
	},
	adminCatchAll: {
		surface: 'page',
		summary:
			'Admin shell for unknown paths (200; the not-found UI renders in the page)',
		reach: 'browse --path /admin/does-not-exist',
	},
	adminApiFeeds: {
		surface: 'admin-api',
		summary: 'List all feeds',
		methods: 'GET',
		reach: 'request GET /admin/api/feeds --contains "["',
	},
	adminApiDirectories: {
		surface: 'admin-api',
		summary: 'List media roots',
		methods: 'GET',
		reach: 'request GET /admin/api/directories --contains audio',
	},
	adminApiBrowse: {
		surface: 'admin-api',
		summary: 'Browse a media root directory',
		methods: 'GET',
		reach:
			'request GET "/admin/api/browse?root=audio&path=" --contains Inkheart',
	},
	adminApiCreateDirectoryFeed: {
		surface: 'admin-api',
		summary: 'Create a directory feed',
		methods: 'POST',
		reach:
			'request POST /admin/api/feeds/directory --json-body \'{"name":"Audio","directoryPaths":["audio:"]}\' --status 201',
	},
	adminApiCreateCuratedFeed: {
		surface: 'admin-api',
		summary: 'Create a curated feed (also creates its first token)',
		methods: 'POST',
		reach: 'execute --code-file tools/control-fixtures/curated-feed.ts',
	},
	adminApiFeedAnalytics: {
		surface: 'admin-api',
		summary: 'Feed analytics for a time window',
		methods: 'GET',
		seed: curatedFeedSeed,
		reach: 'request GET "/admin/api/feeds/<id>/analytics?days=30"',
	},
	adminApiFeed: {
		surface: 'admin-api',
		summary: 'Get, update, or delete a feed',
		methods: 'GET, PUT, DELETE',
		seed: curatedFeedSeed,
		reach: 'request GET /admin/api/feeds/<id> --contains tokens',
	},
	adminApiFeedTokens: {
		surface: 'admin-api',
		summary: 'Create a feed access token',
		methods: 'POST',
		seed: curatedFeedSeed,
		reach:
			'request POST /admin/api/feeds/<id>/tokens --json-body \'{"label":"test"}\'',
		high: true,
	},
	adminApiFeedItems: {
		surface: 'admin-api',
		summary: 'Add, remove, or reorder curated feed items',
		methods: 'POST, DELETE, PATCH',
		seed: curatedFeedSeed,
		reach:
			'request POST /admin/api/feeds/<id>/items --json-body \'{"items":["video:Toy Story.mkv"]}\'',
	},
	adminApiFeedArtwork: {
		surface: 'admin-api',
		summary: 'Get, upload, or delete feed artwork (writes data/artwork)',
		methods: 'GET, POST, DELETE',
		seed: curatedFeedSeed,
		reach: 'request GET /admin/api/feeds/<id>/artwork',
	},
	adminApiToken: {
		surface: 'admin-api',
		summary: 'Revoke a feed token',
		methods: 'DELETE',
		seed: curatedFeedSeed,
		reach: 'request DELETE /admin/api/tokens/<token>',
		high: true,
	},
	adminApiMediaAnalytics: {
		surface: 'admin-api',
		summary: 'Analytics for one media file across feeds',
		methods: 'GET',
		reach: 'request GET /admin/api/media-analytics/audio/Inkheart.m4b',
	},
	adminApiMedia: {
		surface: 'admin-api',
		summary: 'List all media with metadata',
		methods: 'GET',
		reach: 'request GET /admin/api/media --contains Inkheart',
	},
	adminApiMediaAssignments: {
		surface: 'admin-api',
		summary: 'Read or change which feeds a media file belongs to',
		methods: 'GET, PUT, POST',
		seed: curatedFeedSeed,
		reach: 'request GET /admin/api/media/assignments',
	},
	adminApiMediaDetail: {
		surface: 'admin-api',
		summary: 'One media file’s metadata and assignments',
		methods: 'GET',
		reach:
			'request GET /admin/api/media/audio/Inkheart.m4b --contains Inkheart',
	},
	adminApiMediaMetadata: {
		surface: 'admin-api',
		summary: 'Write metadata tags into a media file (ffmpeg)',
		methods: 'PUT',
		seed: 'Writes the copy under data/control/<port>/media; run dev --fresh to reset',
		reach:
			'request PUT /admin/api/media/audio/Inkheart.m4b/metadata --json-body \'{"title":"Inkheart"}\'',
	},
	adminApiMediaStream: {
		surface: 'admin-api',
		summary: 'Stream media for the admin player (no token)',
		methods: 'GET',
		reach:
			'request GET /admin/api/media-stream/audio/Inkheart.m4b --status 200',
	},
	adminApiMediaUpload: {
		surface: 'admin-api',
		summary: 'Upload a media file into a writable media root',
		methods: 'POST',
		seed: 'Uploads land in data/control/<port>/media; run dev --fresh to reset',
		reach: 'browse --path /admin/media --record (upload UI)',
	},
	adminApiArtwork: {
		surface: 'admin-api',
		summary: 'Embedded artwork for a media file',
		methods: 'GET',
		reach: 'request GET /admin/api/artwork/audio/Inkheart.m4b',
	},
} satisfies Record<RouteName, FeatureNote>
