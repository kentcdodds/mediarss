import type { Action } from '@remix-run/fetch-router'
import { Layout } from '#app/components/layout.tsx'
import type routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'

export default {
	middleware: [],
	action() {
		// Client-only app - serve empty shell, client renders everything
		return render(Layout({}))
	},
} satisfies Action<typeof routes.home.method, typeof routes.home.pattern.source>
