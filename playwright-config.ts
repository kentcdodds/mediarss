import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 22052)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`

export default defineConfig({
	testDir: './playwright',
	testMatch: '**/*.pw.ts',
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	workers: 1,
	use: {
		// Full Chromium in headless mode, so `playwright install --no-shell` is enough.
		channel: 'chromium',
		baseURL,
		trace: 'retain-on-failure',
	},
	webServer: {
		// Fresh control environment: fixture media and throwaway databases.
		command: `npm run --silent control -- dev --foreground --fresh --port ${port}`,
		url: `${baseURL}/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
