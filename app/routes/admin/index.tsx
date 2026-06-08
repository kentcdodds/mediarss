import { type Action } from 'remix/router'
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
	handler() {
		return render(
			Layout({
				title: 'MediaRSS Admin',
				entryScript: '/app/client/admin/entry.tsx',
			}),
		)
	},
}

export const adminHandler = adminShellHandler satisfies Action<
	typeof routes.admin
>

export const adminCatchAllHandler = adminShellHandler satisfies Action<
	typeof routes.adminCatchAll
>
