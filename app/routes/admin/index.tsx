import { type BuildAction } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'
import { handleAdminRequest } from './server-rendering.tsx'

/**
 * Admin shell handler.
 * Serves the HTML shell for all /admin/* routes (except /admin/api/*).
 * The client-side app handles routing from here.
 */
const adminShellHandler = {
	middleware: [],
	handler({ request }: { request: Request }) {
		return handleAdminRequest(request)
	},
}

export const adminHandler = adminShellHandler satisfies BuildAction<
	typeof routes.admin.method,
	typeof routes.admin.pattern
>

export const adminCatchAllHandler = adminShellHandler satisfies BuildAction<
	typeof routes.adminCatchAll.method,
	typeof routes.adminCatchAll.pattern
>
