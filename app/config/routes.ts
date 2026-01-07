import { route } from '@remix-run/fetch-router'

export default route({
	feed: '/feed/:token',
	media: '/media/:token/*path',
	art: '/art/:token/*path',
	// OAuth routes (public)
	oauthToken: '/oauth/token',
	oauthJwks: '/oauth/jwks',
	oauthServerMetadata: '/.well-known/oauth-authorization-server',
	// Admin routes
	adminHealth: '/admin/health',
	adminApiVersion: '/admin/api/version',
	adminAuthorize: '/admin/authorize',
	admin: '/admin',
	adminCatchAll: '/admin/*path',
	adminApiFeeds: '/admin/api/feeds',
	adminApiDirectories: '/admin/api/directories',
	adminApiBrowse: '/admin/api/browse',
	adminApiCreateDirectoryFeed: '/admin/api/feeds/directory',
	adminApiCreateCuratedFeed: '/admin/api/feeds/curated',
	adminApiFeed: '/admin/api/feeds/:id',
	adminApiFeedTokens: '/admin/api/feeds/:id/tokens',
	adminApiFeedItems: '/admin/api/feeds/:id/items',
	adminApiFeedArtwork: '/admin/api/feeds/:id/artwork',
	adminApiToken: '/admin/api/tokens/:token',
	adminApiMedia: '/admin/api/media',
	adminApiMediaAssignments: '/admin/api/media/assignments',
	adminApiMediaDetail: '/admin/api/media/*path',
	adminApiMediaStream: '/admin/api/media-stream/*path',
	adminApiArtwork: '/admin/api/artwork/*path',
})
