import { expect, type Page, test } from '@playwright/test'

/**
 * `rmxOn('input')` is attached only after hydration. `selectOption` before
 * that sets the DOM value without updating the URL, and the handler does
 * not read the current value on mount.
 */
async function selectMediaSort(page: Page, value: string, url: RegExp) {
	const sortSelect = page.locator('#media-sort')
	await expect(sortSelect).toBeVisible()

	await expect(async () => {
		if ((await sortSelect.inputValue()) === value) {
			await sortSelect.selectOption(
				value === 'recently-modified' ? 'title-az' : 'recently-modified',
			)
		}
		await sortSelect.selectOption(value)
		expect(page.url()).toMatch(url)
	}).toPass()
}

test('admin media sort select reflects URL state across navigation', async ({
	page,
}) => {
	await page.goto('/admin/media?q=demo')

	const sortSelect = page.locator('#media-sort')
	await expect(sortSelect).toHaveValue('recently-modified')

	await selectMediaSort(
		page,
		'title-az',
		/\/admin\/media\?q=demo&sort=title-az$/,
	)
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

test('query-only replace navigation preserves scroll position', async ({
	page,
}) => {
	await page.goto('/admin/media?q=demo')

	await page.evaluate(() => {
		const spacer = document.createElement('div')
		spacer.id = 'playwright-scroll-spacer'
		spacer.style.height = '3000px'
		document.body.appendChild(spacer)
	})

	await page.evaluate(() => window.scrollTo(0, 1200))
	await page.waitForTimeout(100)

	await selectMediaSort(
		page,
		'title-az',
		/\/admin\/media\?q=demo&sort=title-az$/,
	)

	const scrollY = await page.evaluate(() => window.scrollY)
	expect(scrollY).toBeGreaterThanOrEqual(1100)
})

test('back navigation restores a query-synced entry without a document reload', async ({
	page,
}) => {
	await page.goto('/admin/media')

	const sortSelect = page.locator('#media-sort')
	await selectMediaSort(page, 'title-az', /\/admin\/media\?sort=title-az$/)

	const documentRequests: Array<string> = []
	page.on('request', (request) => {
		if (request.resourceType() === 'document')
			documentRequests.push(request.url())
	})

	await page.locator('footer a[href="/admin/version"]').click()
	await expect(
		page.getByRole('heading', { name: 'Version Information' }),
	).toBeVisible()

	await page.goBack()
	await expect(page).toHaveURL(/\/admin\/media\?sort=title-az$/)
	await expect(sortSelect).toHaveValue('title-az')
	await expect(
		page.getByRole('heading', { name: 'Media Library' }),
	).toBeVisible()
	expect(documentRequests).toHaveLength(0)
})
