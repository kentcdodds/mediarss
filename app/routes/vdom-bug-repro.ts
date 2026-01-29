import type { BuildAction } from 'remix/fetch-router'
import { Layout } from '#app/components/layout.tsx'
import type routes from '#app/config/routes.ts'
import { render } from '#app/helpers/render.ts'

/**
 * Minimal reproduction page for Remix VDOM bug.
 * Demonstrates that handle.update() doesn't update DOM when called
 * from a component created during a parent's re-render.
 */
export default {
	middleware: [],
	action() {
		return render(
			Layout({
				title: 'VDOM Bug Reproduction',
				entryScript: '/app/client/vdom-bug-repro.tsx',
			}),
		)
	},
} satisfies BuildAction<
	typeof routes.vdomBugRepro.method,
	typeof routes.vdomBugRepro.pattern
>
