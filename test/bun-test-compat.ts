import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
	type MockInstance,
	vi,
} from 'vitest'

declare module 'vitest' {
	interface Assertion<T = any> {
		toBeString(): void
		toBeNumber(): void
		toBeArray(): void
	}
}

expect.extend({
	toBeArray(received: unknown) {
		const pass = Array.isArray(received)
		return {
			pass,
			message: () =>
				pass
					? 'Expected value not to be an array'
					: `Expected ${typeof received} to be an array`,
		}
	},
	toBeNumber(received: unknown) {
		const pass = typeof received === 'number'
		return {
			pass,
			message: () =>
				pass
					? 'Expected value not to be a number'
					: `Expected ${typeof received} to be a number`,
		}
	},
	toBeString(received: unknown) {
		const pass = typeof received === 'string'
		return {
			pass,
			message: () =>
				pass
					? 'Expected value not to be a string'
					: `Expected ${typeof received} to be a string`,
		}
	},
})

export { afterAll, afterEach, beforeAll, beforeEach, expect, test }

export const spyOn = vi.spyOn
export type Mock<T extends (...args: any[]) => any> = MockInstance<T>
