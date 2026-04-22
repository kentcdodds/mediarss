import { expect, test } from '@playwright/test'

test('admin media sort select reflects URL state across navigation', async ({
	page,
}) => {
	await page.goto('/admin/media?q=demo')

	const sortSelect = page.locator('#media-sort')
	await expect(sortSelect).toHaveValue('recently-modified')

	await sortSelect.selectOption('title-az')
	await expect(page).toHaveURL(/\/admin\/media\?q=demo&sort=title-az$/)
	await expect(sortSelect).toHaveValue('title-az')
	await page.reload()
	await expect(page).toHaveURL(/\/admin\/media\?q=demo&sort=title-az$/)
	await expect(sortSelect).toHaveValue('title-az')

	await page.goto('/admin/media?q=demo')
	await expect(sortSelect).toHaveValue('recently-modified')

	await page.goto('/admin/media?q=demo&sort=title-az')
	await expect(sortSelect).toHaveValue('title-az')
	await page.goBack()
	await expect(page).toHaveURL(/\/admin\/media\?q=demo$/)
	await expect(sortSelect).toHaveValue('recently-modified')

	await page.goForward()
	await expect(page).toHaveURL(/\/admin\/media\?q=demo&sort=title-az$/)
	await expect(sortSelect).toHaveValue('title-az')
})
