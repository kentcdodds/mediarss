import { route } from '@remix-run/fetch-router'

export default route({
	feed: '/feed/:token',
	media: '/media/:token/*path',
	art: '/art/:token/*path',
	// Admin routes
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
	adminApiToken: '/admin/api/tokens/:token',
})
