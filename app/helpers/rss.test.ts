import { expect, test } from 'bun:test'
import { getSyntheticPubDate, isSortingByPubDate } from './rss.ts'

test('isSortingByPubDate correctly identifies pubDate as primary sort field', () => {
	// Returns true when pubDate/publicationDate is the primary sort field
	expect(isSortingByPubDate('pubDate')).toBe(true)
	expect(isSortingByPubDate('publicationDate')).toBe(true)
	expect(isSortingByPubDate('pubDate,title')).toBe(true)
	expect(isSortingByPubDate('publicationDate,author')).toBe(true)

	// Returns false for other primary sort fields
	expect(isSortingByPubDate('trackNumber')).toBe(false)
	expect(isSortingByPubDate('filename')).toBe(false)
	expect(isSortingByPubDate('title')).toBe(false)
	expect(isSortingByPubDate('position')).toBe(false) // curated feeds

	// Returns false when pubDate is only a secondary sort field
	expect(isSortingByPubDate('trackNumber,pubDate')).toBe(false)
	expect(isSortingByPubDate('title,publicationDate')).toBe(false)
})

test('getSyntheticPubDate generates sequential dates starting from January 1, 1990', () => {
	// Verify the base date (index 0)
	const date0 = getSyntheticPubDate(0)
	expect(date0.getUTCFullYear()).toBe(1990)
	expect(date0.getUTCMonth()).toBe(0) // January
	expect(date0.getUTCDate()).toBe(1)

	// Verify sequential dates increment by one day
	const date1 = getSyntheticPubDate(1)
	expect(date1.getUTCFullYear()).toBe(1990)
	expect(date1.getUTCMonth()).toBe(0)
	expect(date1.getUTCDate()).toBe(2)

	const oneDayMs = 24 * 60 * 60 * 1000
	const date10 = getSyntheticPubDate(10)
	expect(date1.getTime() - date0.getTime()).toBe(oneDayMs)
	expect(date10.getTime() - date0.getTime()).toBe(10 * oneDayMs)

	// Verify dates maintain strict ordering for a range of indices
	const dates = Array.from({ length: 100 }, (_, i) => getSyntheticPubDate(i))
	for (let i = 1; i < dates.length; i++) {
		expect(dates[i]!.getTime()).toBeGreaterThan(dates[i - 1]!.getTime())
	}

	// Verify large indices work correctly (index 1000 = ~2.7 years after 1990-01-01)
	const date1000 = getSyntheticPubDate(1000)
	expect(date1000.getUTCFullYear()).toBe(1992)
	expect(date1000.getUTCMonth()).toBe(8) // September (0-indexed)
	expect(date1000.getUTCDate()).toBe(27)

	// All dates should be in the past (even with 10000+ items)
	const now = new Date()
	const largeIndexDate = getSyntheticPubDate(10000)
	expect(largeIndexDate.getTime()).toBeLessThan(now.getTime())
})
