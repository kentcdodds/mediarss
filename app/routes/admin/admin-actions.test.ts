import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { sql } from '#app/db/sql.ts'
import { handleAdminPost } from './admin-actions.tsx'

migrate(db)

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

function expectInvalidFormBackLink(text: string, href: string) {
	expect(text).toContain('Invalid form')
	expect(text).toContain(`href="${href}"`)
}

test('invalid admin form frame response only renders frame content', async () => {
	const { response, text } = await postAdminFrame(new FormData())

	expect(response.status).toBe(400)
	expect(text).toContain('data-admin-frame')
	expect(text).toContain('Invalid form')
	expect(text).not.toContain('<html')
	expect(text).not.toContain('<body')
})

test('add item returns invalid form for unknown feed id', async () => {
	const formData = new FormData()
	formData.set('_action', 'add-item')
	formData.set('feedId', 'missing-feed-id')
	formData.set('mediaPath', 'audio:episode.mp3')

	const { response, text } = await postAdminFrame(formData)

	expect(response.status).toBe(400)
	expectInvalidFormBackLink(text, '/admin')
	expect(text).toContain('Unknown feed.')
})

test('remove item returns invalid form for unknown feed id', async () => {
	const formData = new FormData()
	formData.set('_action', 'remove-item')
	formData.set('feedId', 'missing-feed-id')
	formData.set('mediaPath', 'audio:episode.mp3')

	const { response, text } = await postAdminFrame(formData)

	expect(response.status).toBe(400)
	expectInvalidFormBackLink(text, '/admin')
	expect(text).toContain('Unknown feed.')
})

test('clear items returns invalid form for unknown feed id', async () => {
	const formData = new FormData()
	formData.set('_action', 'clear-items')
	formData.set('feedId', 'missing-feed-id')

	const { response, text } = await postAdminFrame(formData)

	expect(response.status).toBe(400)
	expectInvalidFormBackLink(text, '/admin')
	expect(text).toContain('Unknown feed.')
})

test('new directory validation links back to the directory form', async () => {
	const formData = new FormData()
	formData.set('_action', 'create-directory-feed')
	formData.set('name', 'Broken Directory Feed')
	formData.set('directoryPaths', 'missing-root:episode.mp3')

	const { response, text } = await postAdminFrame(formData)

	expect(response.status).toBe(400)
	expectInvalidFormBackLink(text, '/admin/feeds/new/directory')
	expect(text).toContain('Unknown media root "missing-root".')
})

test('existing directory validation links back to the feed detail form', async () => {
	const feed = await createDirectoryFeed({
		name: `admin-actions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		directoryPaths: ['audio:existing'],
	})
	try {
		const formData = new FormData()
		formData.set('_action', 'update-feed')
		formData.set('feedId', feed.id)
		formData.set('name', 'Updated Directory Feed')
		formData.set('directoryPaths', 'missing-root:episode.mp3')

		const { response, text } = await postAdminFrame(formData)

		expect(response.status).toBe(400)
		expectInvalidFormBackLink(text, `/admin/feeds/${feed.id}`)
		expect(text).toContain('Unknown media root "missing-root".')
	} finally {
		db.query(sql`DELETE FROM directory_feed_tokens WHERE feed_id = ?;`).run(
			feed.id,
		)
		await deleteDirectoryFeed(feed.id)
	}
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
