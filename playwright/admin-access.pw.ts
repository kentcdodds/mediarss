import { expect, test } from '@playwright/test'

test('redirects to admin and opens media library without full page refresh', async ({
	page,
}) => {
	await page.goto('/')

	await expect(page).toHaveURL(/\/admin\/?$/)
	await expect(
		page.getByRole('heading', { level: 2, name: 'Your Feeds' }),
	).toBeVisible()

	// Set a marker in the window object to detect full page refreshes
	// If the page is fully refreshed, this marker will be lost
	await page.evaluate(() => {
		;(window as any).__SPA_NAVIGATION_MARKER__ = Date.now()
	})

	// Store the marker value
	const markerBefore = await page.evaluate(
		() => (window as any).__SPA_NAVIGATION_MARKER__,
	)
	expect(markerBefore).toBeTruthy()

	// Click the navigation link
	await page.getByRole('link', { name: 'Manage Access' }).click()

	// Wait for navigation to complete
	await expect(page).toHaveURL(/\/admin\/media\/?$/)
	await expect(
		page.getByRole('heading', { level: 2, name: 'Media Library' }),
	).toBeVisible()

	// Verify the marker still exists (proves no full page refresh occurred)
	const markerAfter = await page.evaluate(
		() => (window as any).__SPA_NAVIGATION_MARKER__,
	)
	expect(markerAfter).toBe(markerBefore)
})
