import { afterEach, beforeEach, type Mock, spyOn } from 'bun:test'
import { resetRateLimiters } from '#app/helpers/rate-limiter.ts'

export let consoleError: Mock<typeof console.error>
export let consoleWarn: Mock<typeof console.warn>

beforeEach(() => {
	// Reset rate limiters between tests to ensure clean state
	// This is important since failed requests now incur penalties
	resetRateLimiters()

	const originalConsoleError = console.error
	consoleError = spyOn(console, 'error')
	consoleError.mockImplementation(
		(...args: Parameters<typeof console.error>) => {
			originalConsoleError(...args)
			throw new Error(
				'Console error was called. Call consoleError.mockImplementation(() => {}) if this is expected.',
			)
		},
	)

	const originalConsoleWarn = console.warn
	consoleWarn = spyOn(console, 'warn')
	consoleWarn.mockImplementation((...args: Parameters<typeof console.warn>) => {
		originalConsoleWarn(...args)
		throw new Error(
			'Console warn was called. Call consoleWarn.mockImplementation(() => {}) if this is expected.',
		)
	})
})

afterEach(() => {
	consoleError.mockRestore()
	consoleWarn.mockRestore()
})
