import { expect, test } from 'bun:test'
import { formatEpisodeNumber, isSortingByPubDate } from './rss.ts'

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

test('formatEpisodeNumber generates zero-padded episode numbers', () => {
	// Edge case: single item feed
	expect(formatEpisodeNumber(0, 1)).toBe('1. ')

	// Edge case: empty feed (handled by Math.max(1, ...) safeguard)
	expect(formatEpisodeNumber(0, 0)).toBe('1. ')

	// Single digit total (1-9 items): 1 digit
	expect(formatEpisodeNumber(0, 5)).toBe('1. ')
	expect(formatEpisodeNumber(4, 5)).toBe('5. ')

	// Double digit total (10-99 items): 2 digits
	expect(formatEpisodeNumber(0, 10)).toBe('01. ')
	expect(formatEpisodeNumber(9, 10)).toBe('10. ')
	expect(formatEpisodeNumber(0, 99)).toBe('01. ')
	expect(formatEpisodeNumber(98, 99)).toBe('99. ')

	// Triple digit total (100-999 items): 3 digits
	expect(formatEpisodeNumber(0, 100)).toBe('001. ')
	expect(formatEpisodeNumber(99, 100)).toBe('100. ')
	expect(formatEpisodeNumber(0, 500)).toBe('001. ')
	expect(formatEpisodeNumber(499, 500)).toBe('500. ')

	// Quad digit total (1000+ items): 4 digits
	expect(formatEpisodeNumber(0, 1000)).toBe('0001. ')
	expect(formatEpisodeNumber(999, 1000)).toBe('1000. ')
})

test('formatEpisodeNumber maintains lexicographic ordering', () => {
	// Verify that formatted numbers sort correctly as strings
	const numbers = Array.from({ length: 150 }, (_, i) =>
		formatEpisodeNumber(i, 150),
	)

	// Sort as strings and verify order is maintained
	const sorted = [...numbers].sort()
	expect(sorted).toEqual(numbers)
})
