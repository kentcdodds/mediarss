import { createRouter } from '@remix-run/fetch-router'
import { html } from '@remix-run/html-template'
import { logger } from '@remix-run/logger-middleware'
import { staticFiles } from '@remix-run/static-middleware'
import { Layout } from '#app/components/layout.tsx'
import routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'
import homeHandlers from '#app/routes/home.tsx'

const router = createRouter({
	middleware: [
		staticFiles('./app/assets', {
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
		)
	},
})

router.map(routes.home, homeHandlers)

export default router
