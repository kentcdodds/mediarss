import { type Action } from 'remix/router'
import type routes from '#app/config/routes.ts'
import { renderDocument } from '#app/helpers/render.ts'
import { AdminDocument } from './document.tsx'
import { loadAdminRouteData } from './loaders.ts'

/**
 * Admin app handler.
 * Server-renders the hydrated admin root for direct page loads.
 */
const adminShellHandler = {
	middleware: [],
	async handler({ request }: { request: Request }) {
		return renderDocument(
			<AdminDocument
				url={request.url}
				loaderData={await loadAdminRouteData(request)}
			/>,
			{ request },
		)
	},
}

export const adminHandler = adminShellHandler satisfies Action<
	typeof routes.admin
>

export const adminCatchAllHandler = adminShellHandler satisfies Action<
	typeof routes.adminCatchAll
>
