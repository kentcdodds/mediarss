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
