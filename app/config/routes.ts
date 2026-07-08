import { route } from 'remix/routes'

export const rootRoutes = route({
	feed: '/feed/:token',
	media: '/media/:token/*path',
	art: '/art/:token/*path',
	oauthServerMetadata: '/.well-known/oauth-authorization-server',
	mcpProtectedResource: '/.well-known/oauth-protected-resource/mcp',
})

export const oauthRoutes = route({
	token: '/token',
	jwks: '/jwks',
	register: '/register',
})

export const mcpRoutes = route({
	index: '/',
	widget: '/widget/:token/*path',
})

export const adminRoutes = route({
	health: '/health',
	authorize: '/authorize',
	index: '/',
	feedNew: '/feeds/new',
	feedEdit: '/feeds/:id/edit',
	feed: '/feeds/:id',
	mediaIndex: '/media',
	mediaEdit: '/media/*path/edit',
	mediaDetail: '/media/*path',
	version: '/version',
	catchAll: '/*path',
})

export const adminApiRoutes = route({
	version: '/version',
	feeds: '/feeds',
	directories: '/directories',
	browse: '/browse',
	createDirectoryFeed: '/feeds/directory',
	createCuratedFeed: '/feeds/curated',
	feedAnalytics: '/feeds/:id/analytics',
	feed: '/feeds/:id',
	feedTokens: '/feeds/:id/tokens',
	feedItems: '/feeds/:id/items',
	feedArtwork: '/feeds/:id/artwork',
	token: '/tokens/:token',
	mediaAnalytics: '/media-analytics/*path',
	media: '/media',
	mediaAssignments: '/media/assignments',
	mediaDetail: '/media/*path',
	mediaMetadata: '/media/*path/metadata',
	mediaStream: '/media-stream/*path',
	mediaUpload: '/media/upload',
	artwork: '/artwork/*path',
})

const mountedOauthRoutes = route('/oauth', oauthRoutes)
const mountedMcpRoutes = route('/mcp', mcpRoutes)
const mountedAdminRoutes = route('/admin', adminRoutes)
const mountedAdminApiRoutes = route('/admin/api', adminApiRoutes)

export default {
	...rootRoutes,
	oauthToken: mountedOauthRoutes.token,
	oauthJwks: mountedOauthRoutes.jwks,
	oauthRegister: mountedOauthRoutes.register,
	mcp: mountedMcpRoutes.index,
	mcpWidget: mountedMcpRoutes.widget,
	adminHealth: mountedAdminRoutes.health,
	adminApiVersion: mountedAdminApiRoutes.version,
	adminAuthorize: mountedAdminRoutes.authorize,
	admin: mountedAdminRoutes.index,
	adminFeedNew: mountedAdminRoutes.feedNew,
	adminFeedEdit: mountedAdminRoutes.feedEdit,
	adminFeed: mountedAdminRoutes.feed,
	adminMedia: mountedAdminRoutes.mediaIndex,
	adminMediaEdit: mountedAdminRoutes.mediaEdit,
	adminMediaDetail: mountedAdminRoutes.mediaDetail,
	adminVersion: mountedAdminRoutes.version,
	adminCatchAll: mountedAdminRoutes.catchAll,
	adminApiFeeds: mountedAdminApiRoutes.feeds,
	adminApiDirectories: mountedAdminApiRoutes.directories,
	adminApiBrowse: mountedAdminApiRoutes.browse,
	adminApiCreateDirectoryFeed: mountedAdminApiRoutes.createDirectoryFeed,
	adminApiCreateCuratedFeed: mountedAdminApiRoutes.createCuratedFeed,
	adminApiFeedAnalytics: mountedAdminApiRoutes.feedAnalytics,
	adminApiFeed: mountedAdminApiRoutes.feed,
	adminApiFeedTokens: mountedAdminApiRoutes.feedTokens,
	adminApiFeedItems: mountedAdminApiRoutes.feedItems,
	adminApiFeedArtwork: mountedAdminApiRoutes.feedArtwork,
	adminApiToken: mountedAdminApiRoutes.token,
	adminApiMediaAnalytics: mountedAdminApiRoutes.mediaAnalytics,
	adminApiMedia: mountedAdminApiRoutes.media,
	adminApiMediaAssignments: mountedAdminApiRoutes.mediaAssignments,
	adminApiMediaDetail: mountedAdminApiRoutes.mediaDetail,
	adminApiMediaMetadata: mountedAdminApiRoutes.mediaMetadata,
	adminApiMediaStream: mountedAdminApiRoutes.mediaStream,
	adminApiMediaUpload: mountedAdminApiRoutes.mediaUpload,
	adminApiArtwork: mountedAdminApiRoutes.artwork,
} as const
