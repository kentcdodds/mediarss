import type { BuildAction } from 'remix/fetch-router'
import { Layout } from '#app/components/layout.tsx'
import type routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'

/**
 * Admin shell handler.
 * Serves the HTML shell for all /admin/* routes (except /admin/api/*).
 * The client-side app handles routing from here.
 */
const adminShellHandler = {
	middleware: [],
	action() {
		return render(
			Layout({
				title: 'MediaRSS Admin',
				entryScript: '/app/client/admin/entry.tsx',
			}),
		)
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
