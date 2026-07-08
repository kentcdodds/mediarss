import { type Action } from 'remix/router'
import { AdminApp } from '#app/client/admin/app-root.tsx'
import { Layout } from '#app/components/layout.tsx'
import type routes from '#app/config/routes.ts'
import { render, renderComponentParts } from '#app/helpers/render.ts'

/**
 * Admin app handler.
 * Server-renders the hydrated admin root for direct page loads.
 */
const adminShellHandler = {
	middleware: [],
	async handler({ request }: { request: Request }) {
		const adminApp = await renderComponentParts(<AdminApp url={request.url} />)
		return render(
			Layout({
				title: 'MediaRSS Admin',
				head: adminApp.head,
				children: adminApp.body,
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
