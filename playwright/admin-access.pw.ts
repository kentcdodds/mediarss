import { expect, test } from '@playwright/test'

test('redirects to admin and opens media library', async ({ page }) => {
	await page.goto('/')

	await expect(page).toHaveURL(/\/admin\/?$/)
	await expect(
		page.getByRole('heading', { level: 2, name: 'Your Feeds' }),
	).toBeVisible()

	await page.getByRole('link', { name: 'Manage Access' }).click()

	await expect(page).toHaveURL(/\/admin\/media\/?$/)
	await expect(
		page.getByRole('heading', { level: 2, name: 'Media Library' }),
	).toBeVisible()
})

test('navigates between admin routes without full document reload', async ({
	page,
}) => {
	await page.goto('/admin')

	await expect(
		page.getByRole('heading', { level: 2, name: 'Your Feeds' }),
	).toBeVisible()

	let mediaDocumentRequests = 0
	page.on('request', (request) => {
		if (
			request.resourceType() === 'document' &&
			request.url().includes('/admin/media')
		) {
			mediaDocumentRequests++
		}
	})

	const probeToken = await page.evaluate(() => {
		const token = crypto.randomUUID()
		;(window as Window & { __spa_probe?: string }).__spa_probe = token
		return token
	})

	await page.getByRole('link', { name: 'Manage Access' }).click()

	await expect(page).toHaveURL(/\/admin\/media\/?$/)
	await expect(
		page.getByRole('heading', { level: 2, name: 'Media Library' }),
	).toBeVisible()

	const probeAfterNavigation = await page.evaluate(
		() => (window as Window & { __spa_probe?: string }).__spa_probe ?? null,
	)

	expect(probeAfterNavigation).toBe(probeToken)
	expect(mediaDocumentRequests).toBe(0)
})
