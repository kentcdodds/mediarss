import path from 'node:path'
import { createRouter, type Middleware } from '@remix-run/fetch-router'
import { html } from '@remix-run/html-template'
import { Layout } from '#app/components/layout.tsx'
import routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'
import { logger } from '#app/middleware/logger.ts'
import { rateLimit } from '#app/middleware/rate-limit.ts'
import adminApiArtworkHandlers from '#app/routes/admin/api/artwork.ts'
import adminApiBrowseHandlers from '#app/routes/admin/api/browse.ts'
import adminApiDirectoriesHandlers from '#app/routes/admin/api/directories.ts'
import adminApiFeedArtworkHandlers from '#app/routes/admin/api/feeds.$id.artwork.ts'
import adminApiFeedItemsHandlers from '#app/routes/admin/api/feeds.$id.items.ts'
import adminApiFeedTokensHandlers from '#app/routes/admin/api/feeds.$id.tokens.ts'
import adminApiFeedHandlers from '#app/routes/admin/api/feeds.$id.ts'
import adminApiCreateCuratedFeedHandlers from '#app/routes/admin/api/feeds.curated.ts'
import adminApiCreateDirectoryFeedHandlers from '#app/routes/admin/api/feeds.directory.ts'
import adminApiFeedsHandlers from '#app/routes/admin/api/feeds.ts'
import adminApiHealthHandlers from '#app/routes/admin/api/health.ts'
import adminApiMediaDetailHandlers from '#app/routes/admin/api/media.$path.ts'
import adminApiMediaHandlers from '#app/routes/admin/api/media.ts'
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
 * Bun-native static file middleware that uses Bun.file() for proper lazy file handling.
 *
 * See: https://github.com/remix-run/remix/issues/10872
 */
function bunStaticFiles(
	root: string,
	options: { filter?: (path: string) => boolean; cacheControl?: string },
): Middleware {
	const absoluteRoot = path.resolve(root)
	return async (context, next) => {
		if (context.method !== 'GET' && context.method !== 'HEAD') {
			return next()
		}
		const relativePath = context.url.pathname.replace(/^\/+/, '')
		if (options.filter && !options.filter(relativePath)) {
			return next()
		}
		const filePath = path.join(absoluteRoot, relativePath)
		const file = Bun.file(filePath)
		if (!(await file.exists())) {
			return next()
		}
		return new Response(context.method === 'HEAD' ? null : file, {
			headers: {
				'Content-Type': file.type,
				'Content-Length': String(file.size),
				...(options.cacheControl
					? { 'Cache-Control': options.cacheControl }
					: {}),
			},
		})
	}
}

const router = createRouter({
	middleware: [
		rateLimit(),
		bunStaticFiles('./app', {
			filter: (p) => p.startsWith('assets/'),
			cacheControl:
				Bun.env.NODE_ENV === 'production'
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

// OAuth routes (public, before admin routes)
router.map(routes.oauthToken, oauthTokenHandlers)
router.map(routes.oauthJwks, oauthJwksHandlers)
router.map(routes.oauthRegister, oauthRegisterHandlers)
router.map(routes.oauthServerMetadata, oauthServerMetadataHandlers)

// MCP routes (public, require OAuth token)
router.map(routes.mcpProtectedResource, mcpProtectedResourceHandlers)
router.map(routes.mcp, mcpHandlers)
router.map(routes.mcpWidget, mcpWidgetHandlers)

// Admin routes - API routes first (more specific), then catch-all
router.map(routes.adminHealth, adminApiHealthHandlers)
router.map(routes.adminApiVersion, adminApiVersionHandlers)
router.map(routes.adminAuthorize, adminAuthorizeHandlers)
router.map(routes.adminApiFeeds, adminApiFeedsHandlers)
router.map(routes.adminApiDirectories, adminApiDirectoriesHandlers)
router.map(routes.adminApiBrowse, adminApiBrowseHandlers)
router.map(
	routes.adminApiCreateDirectoryFeed,
	adminApiCreateDirectoryFeedHandlers,
)
router.map(routes.adminApiCreateCuratedFeed, adminApiCreateCuratedFeedHandlers)
router.map(routes.adminApiFeedTokens, adminApiFeedTokensHandlers)
router.map(routes.adminApiFeedItems, adminApiFeedItemsHandlers)
router.map(routes.adminApiFeedArtwork, adminApiFeedArtworkHandlers)
router.map(routes.adminApiFeed, adminApiFeedHandlers)
router.map(routes.adminApiToken, adminApiTokenHandlers)
router.map(routes.adminApiMedia, adminApiMediaHandlers)
router.map(routes.adminApiMediaAssignments, adminApiMediaAssignmentsHandlers)
router.map(routes.adminApiMediaUpload, adminApiMediaUploadHandlers)
router.map(routes.adminApiMediaDetail, adminApiMediaDetailHandlers)
router.map(routes.adminApiMediaStream, adminApiMediaStreamHandlers)
router.map(routes.adminApiArtwork, adminApiArtworkHandlers)
router.map(routes.admin, adminHandler)
router.map(routes.adminCatchAll, adminCatchAllHandler)

export default router
