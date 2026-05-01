import { expect, test } from 'vitest'
import '#app/config/init-env.ts'

import { renderAdminPage } from './admin-utils.tsx'

test('admin frame enhancement wraps the page body', async () => {
	const response = renderAdminPage({
		title: 'Admin test',
		target: 'admin-main',
		body: (
			<form method="post" action="/admin/test">
				<button type="submit">Save</button>
			</form>
		),
	})

	const html = await response.text()
	const adminFrameMatches = html.match(/data-admin-frame/g) ?? []

	expect(adminFrameMatches).toHaveLength(1)
	expect(html).toMatch(
		/<div[^>]*data-admin-frame[^>]*>[\s\S]*<form[^>]*method="post"[^>]*action="\/admin\/test"/,
	)
})
