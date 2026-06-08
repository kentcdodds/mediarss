import path from 'node:path'
import { createRouter, type Middleware } from 'remix/router'
import { html } from 'remix/html-template'
import { Layout } from '#app/components/layout.tsx'
import routes, {
	adminApiRoutes,
	adminRoutes,
	mcpRoutes,
	oauthRoutes,
} from '#app/config/routes.ts'
import { fileExists, getFileResponse } from '#app/helpers/node-file.ts'
import { render } from '#app/helpers/render.ts'
import { logger } from '#app/middleware/logger.ts'
import { rateLimit } from '#app/middleware/rate-limit.ts'
import adminApiArtworkHandlers from '#app/routes/admin/api/artwork.ts'
import adminApiBrowseHandlers from '#app/routes/admin/api/browse.ts'
import adminApiDirectoriesHandlers from '#app/routes/admin/api/directories.ts'
import adminApiFeedAnalyticsHandlers from '#app/routes/admin/api/feeds.$id.analytics.ts'
import adminApiFeedArtworkHandlers from '#app/routes/admin/api/feeds.$id.artwork.ts'
import adminApiFeedItemsHandlers from '#app/routes/admin/api/feeds.$id.items.ts'
import adminApiFeedTokensHandlers from '#app/routes/admin/api/feeds.$id.tokens.ts'
import adminApiFeedHandlers from '#app/routes/admin/api/feeds.$id.ts'
import adminApiCreateCuratedFeedHandlers from '#app/routes/admin/api/feeds.curated.ts'
import adminApiCreateDirectoryFeedHandlers from '#app/routes/admin/api/feeds.directory.ts'
import adminApiFeedsHandlers from '#app/routes/admin/api/feeds.ts'
import adminApiHealthHandlers from '#app/routes/admin/api/health.ts'
import adminApiMediaMetadataHandlers from '#app/routes/admin/api/media.$path.metadata.ts'
import adminApiMediaDetailHandlers from '#app/routes/admin/api/media.$path.ts'
import adminApiMediaHandlers from '#app/routes/admin/api/media.ts'
import adminApiMediaAnalyticsHandlers from '#app/routes/admin/api/media-analytics.$path.ts'
import adminApiMediaAssignmentsHandlers from '#app/routes/admin/api/media-assignments.ts'
import adminApiMediaStreamHandlers from '#app/routes/admin/api/media-stream.ts'
import adminApiMediaUploadHandlers from '#app/routes/admin/api/media-upload.ts'
import adminApiTokenHandlers from '#app/routes/admin/api/tokens.$token.ts'
import adminApiVersionHandlers from '#app/routes/admin/api/version.ts'
import adminAuthorizeHandlers from '#app/routes/admin/authorize.tsx'
import { adminCatchAllHandler, adminHandler } from '#app/routes/admin/index.tsx'
import artHandlers from '#app/routes/art.ts'
import feedHandlers from '#app/routes/feed.ts'
import mcpHandlers from '#app/routes/mcp/index.ts'
import mcpProtectedResourceHandlers from '#app/routes/mcp/oauth-protected-resource.ts'
import mcpWidgetHandlers from '#app/routes/mcp/widget.ts'
import mediaHandlers from '#app/routes/media.ts'
import oauthJwksHandlers from '#app/routes/oauth/jwks.ts'
import oauthRegisterHandlers from '#app/routes/oauth/register.ts'
import oauthServerMetadataHandlers from '#app/routes/oauth/server-metadata.ts'
import oauthTokenHandlers from '#app/routes/oauth/token.ts'

/**
 * CORS headers for static files.
 * These need to be accessible cross-origin for MCP widgets embedded in external apps.
 */
const STATIC_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'Accept, Content-Type',
} as const

/**
 * Static file middleware with CORS support for embedded widgets.
 */
function staticFiles(
	root: string,
	options: { filter?: (path: string) => boolean; cacheControl?: string },
): Middleware {
	const absoluteRoot = path.resolve(root)
	return async (context, next) => {
		// Handle CORS preflight requests
		if (context.method === 'OPTIONS') {
			const relativePath = context.url.pathname.replace(/^\/+/, '')
			if (options.filter && !options.filter(relativePath)) {
				return next()
			}
			const filePath = path.join(absoluteRoot, relativePath)
			if (!(await fileExists(filePath))) {
				return next()
			}
			return new Response(null, {
				status: 204,
				headers: {
					...STATIC_CORS_HEADERS,
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		if (context.method !== 'GET' && context.method !== 'HEAD') {
			return next()
		}
		const relativePath = context.url.pathname.replace(/^\/+/, '')
		if (options.filter && !options.filter(relativePath)) {
			return next()
		}
		const filePath = path.join(absoluteRoot, relativePath)
		const response = await getFileResponse(filePath, context.request, {
			cacheControl: options.cacheControl,
		})
		if (!response) {
			return next()
		}
		for (const [key, value] of Object.entries(STATIC_CORS_HEADERS)) {
			response.headers.set(key, value)
		}
		return response
	}
}

const router = createRouter({
	middleware: [
		rateLimit(),
		staticFiles('./public', {
			cacheControl:
				process.env.NODE_ENV === 'production'
					? 'public, max-age=31536000, immutable'
					: 'no-cache',
		}),
		staticFiles('./app', {
			filter: (p) => p.startsWith('assets/'),
			cacheControl:
				process.env.NODE_ENV === 'production'
					? 'public, max-age=31536000, immutable'
					: 'no-cache',
		}),
		logger(),
	],
	defaultHandler() {
		return render(
			Layout({
				entryScript: false,
				children: html`<main><h1>404 Not Found</h1></main>`,
			}),
			{ status: 404 },
		)
	},
})

router.map(routes.feed, feedHandlers)
router.map(routes.media, mediaHandlers)
router.map(routes.art, artHandlers)

router.map(routes.oauthServerMetadata, oauthServerMetadataHandlers)

router.map(routes.mcpProtectedResource, mcpProtectedResourceHandlers)

router.mount('/oauth', (oauth) => {
	oauth.map(oauthRoutes.token, oauthTokenHandlers)
	oauth.map(oauthRoutes.jwks, oauthJwksHandlers)
	oauth.map(oauthRoutes.register, oauthRegisterHandlers)
})

router.mount('/mcp', (mcp) => {
	mcp.map(mcpRoutes.index, mcpHandlers)
	mcp.map(mcpRoutes.widget, mcpWidgetHandlers)
})

router.mount('/admin/api', (adminApi) => {
	adminApi.map(adminApiRoutes.version, adminApiVersionHandlers)
	adminApi.map(adminApiRoutes.feeds, adminApiFeedsHandlers)
	adminApi.map(adminApiRoutes.directories, adminApiDirectoriesHandlers)
	adminApi.map(adminApiRoutes.browse, adminApiBrowseHandlers)
	adminApi.map(
		adminApiRoutes.createDirectoryFeed,
		adminApiCreateDirectoryFeedHandlers,
	)
	adminApi.map(
		adminApiRoutes.createCuratedFeed,
		adminApiCreateCuratedFeedHandlers,
	)
	adminApi.map(adminApiRoutes.feedAnalytics, adminApiFeedAnalyticsHandlers)
	adminApi.map(adminApiRoutes.feedTokens, adminApiFeedTokensHandlers)
	adminApi.map(adminApiRoutes.feedItems, adminApiFeedItemsHandlers)
	adminApi.map(adminApiRoutes.feedArtwork, adminApiFeedArtworkHandlers)
	adminApi.map(adminApiRoutes.feed, adminApiFeedHandlers)
	adminApi.map(adminApiRoutes.token, adminApiTokenHandlers)
	adminApi.map(adminApiRoutes.mediaAnalytics, adminApiMediaAnalyticsHandlers)
	adminApi.map(adminApiRoutes.media, adminApiMediaHandlers)
	adminApi.map(
		adminApiRoutes.mediaAssignments,
		adminApiMediaAssignmentsHandlers,
	)
	adminApi.map(adminApiRoutes.mediaUpload, adminApiMediaUploadHandlers)
	adminApi.map(adminApiRoutes.mediaMetadata, adminApiMediaMetadataHandlers)
	adminApi.map(adminApiRoutes.mediaDetail, adminApiMediaDetailHandlers)
	adminApi.map(adminApiRoutes.mediaStream, adminApiMediaStreamHandlers)
	adminApi.map(adminApiRoutes.artwork, adminApiArtworkHandlers)
})

router.mount('/admin', (admin) => {
	admin.map(adminRoutes.health, adminApiHealthHandlers)
	admin.map(adminRoutes.authorize, adminAuthorizeHandlers)
	admin.map(adminRoutes.index, adminHandler)
	admin.map(adminRoutes.catchAll, adminCatchAllHandler)
})

export default router
