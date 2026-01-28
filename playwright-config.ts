import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 22050)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`

export default defineConfig({
	testDir: './playwright',
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	workers: 1,
	use: {
		baseURL,
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'bun run dev:test',
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			PORT: String(port),
		},
	},
})
