import path from 'node:path'
import { createRouter, type Middleware } from '@remix-run/fetch-router'
import { html } from '@remix-run/html-template'
import { logger } from '@remix-run/logger-middleware'
import { Layout } from '#app/components/layout.tsx'
import routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'
import homeHandlers from '#app/routes/home.tsx'

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
				includeEntryScript: false,
				children: html`<main><h1>404 Not Found</h1></main>`,
			}),
			{ status: 404 },
		)
	},
})

router.map(routes.home, homeHandlers)

export default router
