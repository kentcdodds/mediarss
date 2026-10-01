import { type Action } from 'remix/router'
import { type routes } from '#app/routes.ts'
import { createAdminRedirectResponse } from '#app/helpers/root-redirect.ts'

export default {
	middleware: [],
	handler({ request }) {
		return createAdminRedirectResponse(request)
	},
} satisfies Action<typeof routes.root>
