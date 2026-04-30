import { type BuildAction } from 'remix/fetch-router'
import { AdminApp } from '#app/client/admin/app.tsx'
import { ServerDocument } from '#app/components/server-document.tsx'
import type routes from '#app/config/routes.ts'
import { renderUi } from '#app/helpers/render.ts'

/**
 * Admin shell handler.
 * Serves the HTML shell for all /admin/* routes (except /admin/api/*).
 * The client-side app handles routing from here.
 */
const adminShellHandler = {
	middleware: [],
	handler() {
		return renderUi(
			<ServerDocument
				title="MediaRSS Admin"
				entryScript="/app/client/admin/entry.tsx"
			>
				<AdminApp />
			</ServerDocument>,
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
