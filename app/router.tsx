import { createRouter } from '@remix-run/fetch-router'
import { logger } from '@remix-run/fetch-router/logger-middleware'
import { render } from '#app/helpers/render.ts'
import homeHandlers from '#app/routes/home.tsx'
import routes from '#config/routes.ts'

const router = createRouter({
	middleware: Bun.env.NODE_ENV === 'development' ? [logger()] : [],
	defaultHandler() {
		return render(<h1>404 Not Found</h1>)
	},
})

router.map(routes.home, homeHandlers)

export default router
