import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { handleAdminPost } from './admin-actions.tsx'

async function postAdminFrame(formData: FormData) {
	const response = await handleAdminPost(
		new Request('http://localhost/admin', {
			method: 'POST',
			headers: { 'x-remix-target': 'admin-main' },
			body: formData,
		}),
	)
	const text = await response.text()
	return { response, text }
}

test('invalid admin form frame response only renders frame content', async () => {
	const { response, text } = await postAdminFrame(new FormData())

	expect(response.status).toBe(400)
	expect(text).toContain('data-admin-frame')
	expect(text).toContain('Invalid form')
	expect(text).not.toContain('<html')
	expect(text).not.toContain('<body')
})

test('unsupported admin action frame response only renders frame content', async () => {
	const formData = new FormData()
	formData.set('_action', 'unsupported')

	const { response, text } = await postAdminFrame(formData)

	expect(response.status).toBe(400)
	expect(text).toContain('data-admin-frame')
	expect(text).toContain('Unsupported action')
	expect(text).not.toContain('<html')
	expect(text).not.toContain('<body')
})
