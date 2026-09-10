import { render } from 'remix/middleware/render'
import { createAction } from 'remix/router'
import {
	ADMIN_ENTRY,
	assets,
	getScriptEntry,
	getStylesheetHref,
} from '#app/assets.ts'
import routes from '#app/config/routes.ts'
import { AdminDocument } from './document.tsx'
import { loadAdminRouteData } from './loaders.ts'

const renderUi = render({
	assets,
	onError(error) {
		console.error(error)
	},
})

/**
 * Admin app handler.
 * Server-renders the hydrated admin root for direct page loads and frame
 * navigations; client entries are resolved through the asset server.
 */
function createAdminAction<
	route extends typeof routes.admin | typeof routes.adminCatchAll,
>(route: route) {
	return createAction(route, {
		middleware: [renderUi],
		async handler(context) {
			const { request } = context
			const [loaderData, scriptEntry, stylesheetHref] = await Promise.all([
				loadAdminRouteData(request),
				getScriptEntry(ADMIN_ENTRY),
				getStylesheetHref(),
			])
			return context.render(
				<AdminDocument
					url={request.url}
					loaderData={loaderData}
					scriptEntry={scriptEntry}
					stylesheetHref={stylesheetHref}
				/>,
			)
		},
	})
}

export const adminHandler = createAdminAction(routes.admin)
export const adminCatchAllHandler = createAdminAction(routes.adminCatchAll)
