import type { RouteHandler } from '@remix-run/fetch-router'
import { Counter } from '#app/client/counter.tsx'
import { Layout } from '#app/components/layout.tsx'
import { ModulePreload } from '#app/components/module-preload.tsx'
import { render } from '#app/helpers/render.ts'
import type routes from '#config/routes.ts'

export default {
	middleware: [],
	handler() {
		return render(
			<Layout>
				<h1>Home</h1>
				<ModulePreload url={Counter.$moduleUrl} />
				<Counter initial={5} />
			</Layout>,
		)
	},
} satisfies RouteHandler<
	typeof routes.home.method,
	typeof routes.home.pattern.source
>
