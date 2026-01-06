import path from 'node:path'
import { createRouter, type Middleware } from '@remix-run/fetch-router'
import { html } from '@remix-run/html-template'
import { logger } from '@remix-run/logger-middleware'
import { Layout } from '#app/components/layout.tsx'
import routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'
import adminApiBrowseHandlers from '#app/routes/admin/api/browse.ts'
import adminApiDirectoriesHandlers from '#app/routes/admin/api/directories.ts'
import adminApiFeedHandlers from '#app/routes/admin/api/feeds.$id.ts'
import adminApiFeedTokensHandlers from '#app/routes/admin/api/feeds.$id.tokens.ts'
import adminApiCreateCuratedFeedHandlers from '#app/routes/admin/api/feeds.curated.ts'
import adminApiCreateDirectoryFeedHandlers from '#app/routes/admin/api/feeds.directory.ts'
import adminApiFeedsHandlers from '#app/routes/admin/api/feeds.ts'
import adminApiTokenHandlers from '#app/routes/admin/api/tokens.$token.ts'
import { adminCatchAllHandler, adminHandler } from '#app/routes/admin/index.tsx'
import artHandlers from '#app/routes/art.ts'
import feedHandlers from '#app/routes/feed.ts'
import homeHandlers from '#app/routes/home.tsx'
import mediaHandlers from '#app/routes/media.ts'

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
		bunStaticFiles('./app', {
			filter: (p) => p.startsWith('assets/'),
			cacheControl:
				Bun.env.NODE_ENV === 'production'
					? 'public, max-age=31536000, immutable'
					: 'no-cache',
		}),
		...(Bun.env.NODE_ENV === 'development' ? [logger()] : []),
	].filter(Boolean),
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

router.map(routes.home, homeHandlers)
router.map(routes.feed, feedHandlers)
router.map(routes.media, mediaHandlers)
router.map(routes.art, artHandlers)

// Admin routes - API routes first (more specific), then catch-all
router.map(routes.adminApiFeeds, adminApiFeedsHandlers)
router.map(routes.adminApiDirectories, adminApiDirectoriesHandlers)
router.map(routes.adminApiBrowse, adminApiBrowseHandlers)
router.map(routes.adminApiCreateDirectoryFeed, adminApiCreateDirectoryFeedHandlers)
router.map(routes.adminApiCreateCuratedFeed, adminApiCreateCuratedFeedHandlers)
router.map(routes.adminApiFeedTokens, adminApiFeedTokensHandlers)
router.map(routes.adminApiFeed, adminApiFeedHandlers)
router.map(routes.adminApiToken, adminApiTokenHandlers)
router.map(routes.admin, adminHandler)
router.map(routes.adminCatchAll, adminCatchAllHandler)

export default router
