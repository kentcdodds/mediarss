import { expect, test } from '@playwright/test'

test('direct GET of the media edit route loads the metadata form', async ({
	page,
}) => {
	await page.goto('/admin/media/audio/Inkheart.m4b/edit')

	await expect(page.getByText('Failed to load media')).toHaveCount(0)
	await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
		/Inkheart/i,
	)
})
