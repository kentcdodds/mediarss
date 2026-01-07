import { describe, expect, test } from 'bun:test'
import { getSyntheticPubDate, isSortingByPubDate } from './rss.ts'

describe('isSortingByPubDate', () => {
	test('returns true for pubDate sort field', () => {
		expect(isSortingByPubDate('pubDate')).toBe(true)
	})

	test('returns true for publicationDate sort field', () => {
		expect(isSortingByPubDate('publicationDate')).toBe(true)
	})

	test('returns true for pubDate with secondary sort fields', () => {
		expect(isSortingByPubDate('pubDate,title')).toBe(true)
		expect(isSortingByPubDate('publicationDate,author')).toBe(true)
	})

	test('returns false for trackNumber sort field', () => {
		expect(isSortingByPubDate('trackNumber')).toBe(false)
	})

	test('returns false for filename sort field', () => {
		expect(isSortingByPubDate('filename')).toBe(false)
	})

	test('returns false for title sort field', () => {
		expect(isSortingByPubDate('title')).toBe(false)
	})

	test('returns false for position sort field (curated feeds)', () => {
		expect(isSortingByPubDate('position')).toBe(false)
	})

	test('returns false when pubDate is a secondary sort field', () => {
		// pubDate must be the primary sort field
		expect(isSortingByPubDate('trackNumber,pubDate')).toBe(false)
		expect(isSortingByPubDate('title,publicationDate')).toBe(false)
	})
})

describe('getSyntheticPubDate', () => {
	test('returns January 1, 1990 for index 0', () => {
		const date = getSyntheticPubDate(0)
		expect(date.getUTCFullYear()).toBe(1990)
		expect(date.getUTCMonth()).toBe(0) // January
		expect(date.getUTCDate()).toBe(1)
	})

	test('returns January 2, 1990 for index 1', () => {
		const date = getSyntheticPubDate(1)
		expect(date.getUTCFullYear()).toBe(1990)
		expect(date.getUTCMonth()).toBe(0)
		expect(date.getUTCDate()).toBe(2)
	})

	test('increments by one day for each index', () => {
		const date0 = getSyntheticPubDate(0)
		const date1 = getSyntheticPubDate(1)
		const date10 = getSyntheticPubDate(10)

		const oneDayMs = 24 * 60 * 60 * 1000

		expect(date1.getTime() - date0.getTime()).toBe(oneDayMs)
		expect(date10.getTime() - date0.getTime()).toBe(10 * oneDayMs)
	})

	test('maintains correct order for many items', () => {
		// Test that dates are strictly increasing for a range of indices
		const dates = Array.from({ length: 100 }, (_, i) => getSyntheticPubDate(i))

		for (let i = 1; i < dates.length; i++) {
			expect(dates[i]!.getTime()).toBeGreaterThan(dates[i - 1]!.getTime())
		}
	})

	test('handles large indices (thousands of items)', () => {
		// Test index 1000 - should be roughly 2.7 years after 1990-01-01
		const date = getSyntheticPubDate(1000)
		expect(date.getUTCFullYear()).toBe(1992)
		expect(date.getUTCMonth()).toBe(8) // September (0-indexed)
		expect(date.getUTCDate()).toBe(27)
	})

	test('all dates are in the past', () => {
		const now = new Date()
		// Even with 10000 items (27+ years), dates should be before now
		const largeIndexDate = getSyntheticPubDate(10000)
		expect(largeIndexDate.getTime()).toBeLessThan(now.getTime())
	})
})
