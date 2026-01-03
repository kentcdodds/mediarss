import type { Action } from '@remix-run/fetch-router'
import { Layout } from '#app/components/layout.tsx'
import { render } from '#app/helpers/render.ts'
import type routes from '#config/routes.ts'

export default {
	middleware: [],
	action() {
		// Client-only app - serve empty shell, client renders everything
		return render(Layout({}))
	},
} satisfies Action<typeof routes.home.method, typeof routes.home.pattern.source>
