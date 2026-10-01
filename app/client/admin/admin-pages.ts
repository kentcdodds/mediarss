import { createMatcher } from 'remix/route-pattern/match'
import { type RoutePattern } from 'remix/route-pattern'

export type AdminPage<Component> = {
	route: { pattern: RoutePattern }
	component: Component
}

export function matchAdminPage<Component>(
	pages: ReadonlyArray<AdminPage<Component>>,
	url: string | URL,
): { component: Component; params: Record<string, string> } | null {
	for (const page of pages) {
		const match = createMatcher(page.route.pattern).match(url)
		if (!match) continue

		const params: Record<string, string> = {}
		for (const [name, value] of Object.entries(match.params)) {
			if (typeof value === 'string') params[name] = value
		}

		return { component: page.component, params }
	}

	return null
}
