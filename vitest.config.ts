import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['app/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
		globalSetup: ['./test/global-setup.ts'],
		maxWorkers: 1,
	},
})
