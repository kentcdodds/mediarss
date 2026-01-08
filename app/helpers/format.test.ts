import { expect, test } from 'bun:test'
import {
	formatDate,
	formatDuration,
	formatFileSize,
	formatItunesDuration,
	formatRelativeTime,
	formatRssDate,
	formatUptime,
} from './format.ts'

test('formatDuration handles various input cases and formats correctly', () => {
	// Fallback behavior
	expect(formatDuration(null)).toBe('—')
	expect(formatDuration(null, { fallback: 'N/A' })).toBe('N/A')
	expect(formatDuration(0)).toBe('—')

	// Seconds only
	expect(formatDuration(45)).toBe('45s')

	// Minutes and seconds
	expect(formatDuration(125)).toBe('2m 5s')

	// Hours and minutes (no seconds by default)
	expect(formatDuration(3725)).toBe('1h 2m')

	// Hours, minutes, and seconds with showSeconds option
	expect(formatDuration(3725, { showSeconds: true })).toBe('1h 2m 5s')
})

test('formatUptime converts milliseconds to human-readable duration', () => {
	expect(formatUptime(45000)).toBe('45s')
	expect(formatUptime(125000)).toBe('2m 5s')
	expect(formatUptime(3725000)).toBe('1h 2m 5s')
	expect(formatUptime(90000000)).toBe('1d 1h 0m')
})

test('formatItunesDuration formats duration for iTunes podcast feeds', () => {
	expect(formatItunesDuration(null)).toBe('')
	expect(formatItunesDuration(125)).toBe('2:05')
	expect(formatItunesDuration(3725)).toBe('1:02:05')
})

test('formatFileSize formats bytes into human-readable sizes', () => {
	expect(formatFileSize(0)).toBe('0 B')
	expect(formatFileSize(500)).toBe('500 B')
	expect(formatFileSize(1536)).toBe('1.5 KB')
	expect(formatFileSize(1572864)).toBe('1.5 MB')
	expect(formatFileSize(1610612736)).toBe('1.5 GB')
})

test('formatDate handles various input types and styles', () => {
	// Null handling
	expect(formatDate(null)).toBe('—')

	// ISO string input
	const isoResult = formatDate('2026-01-07T12:00:00Z', { style: 'date' })
	expect(isoResult).toContain('2026')
	expect(isoResult).toContain('January')
	expect(isoResult).toContain('7')

	// Unix timestamp in seconds
	const timestamp = 1767787200 // Jan 7, 2026 12:00:00 UTC
	const timestampResult = formatDate(timestamp, { style: 'date' })
	expect(timestampResult).toContain('2026')

	// Date object input
	const date = new Date('2026-01-07T12:00:00Z')
	const dateResult = formatDate(date, { style: 'date' })
	expect(dateResult).toContain('2026')

	// Short style returns abbreviated month
	const shortResult = formatDate('2026-01-07T12:00:00Z', { style: 'short' })
	expect(shortResult).toContain('Jan')
	expect(shortResult).toContain('2026')
})

test('formatRssDate returns RFC 2822 format for RSS feeds', () => {
	const date = new Date('2026-01-07T12:00:00Z')
	const result = formatRssDate(date)
	expect(result).toContain('Wed')
	expect(result).toContain('07 Jan 2026')
	expect(result).toContain('GMT')
})

test('formatRelativeTime shows human-friendly time differences', () => {
	expect(formatRelativeTime(null)).toBe('Never')
	expect(formatRelativeTime(new Date())).toBe('just now')

	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
	expect(formatRelativeTime(fiveMinutesAgo)).toBe('5 mins ago')

	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
	expect(formatRelativeTime(threeHoursAgo)).toBe('3 hours ago')

	const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
	expect(formatRelativeTime(twoDaysAgo)).toBe('2 days ago')

	// Unix timestamp in seconds
	const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
	expect(formatRelativeTime(oneHourAgo)).toBe('1 hour ago')
})
