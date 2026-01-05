import { route } from '@remix-run/fetch-router'

export default route({
	home: '/',
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
})
