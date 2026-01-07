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

// formatDuration tests

test('formatDuration returns fallback for null', () => {
	expect(formatDuration(null)).toBe('—')
	expect(formatDuration(null, { fallback: 'N/A' })).toBe('N/A')
})

test('formatDuration returns fallback for zero', () => {
	expect(formatDuration(0)).toBe('—')
})

test('formatDuration formats seconds only', () => {
	expect(formatDuration(45)).toBe('45s')
})

test('formatDuration formats minutes and seconds', () => {
	expect(formatDuration(125)).toBe('2m 5s')
})

test('formatDuration formats hours and minutes (no seconds by default)', () => {
	expect(formatDuration(3725)).toBe('1h 2m')
})

test('formatDuration formats hours, minutes, and seconds with showSeconds option', () => {
	expect(formatDuration(3725, { showSeconds: true })).toBe('1h 2m 5s')
})

// formatUptime tests

test('formatUptime formats seconds', () => {
	expect(formatUptime(45000)).toBe('45s')
})

test('formatUptime formats minutes and seconds', () => {
	expect(formatUptime(125000)).toBe('2m 5s')
})

test('formatUptime formats hours, minutes, and seconds', () => {
	expect(formatUptime(3725000)).toBe('1h 2m 5s')
})

test('formatUptime formats days, hours, and minutes', () => {
	expect(formatUptime(90000000)).toBe('1d 1h 0m')
})

// formatItunesDuration tests

test('formatItunesDuration returns empty string for null', () => {
	expect(formatItunesDuration(null)).toBe('')
})

test('formatItunesDuration formats minutes and seconds', () => {
	expect(formatItunesDuration(125)).toBe('2:05')
})

test('formatItunesDuration formats hours, minutes, and seconds', () => {
	expect(formatItunesDuration(3725)).toBe('1:02:05')
})

// formatFileSize tests

test('formatFileSize formats bytes', () => {
	expect(formatFileSize(500)).toBe('500 B')
})

test('formatFileSize formats kilobytes', () => {
	expect(formatFileSize(1536)).toBe('1.5 KB')
})

test('formatFileSize formats megabytes', () => {
	expect(formatFileSize(1572864)).toBe('1.5 MB')
})

test('formatFileSize formats gigabytes', () => {
	expect(formatFileSize(1610612736)).toBe('1.5 GB')
})

test('formatFileSize returns 0 B for zero', () => {
	expect(formatFileSize(0)).toBe('0 B')
})

// formatDate tests

test('formatDate returns dash for null', () => {
	expect(formatDate(null)).toBe('—')
})

test('formatDate handles ISO string input', () => {
	const result = formatDate('2026-01-07T12:00:00Z', { style: 'date' })
	expect(result).toContain('2026')
	expect(result).toContain('January')
	expect(result).toContain('7')
})

test('formatDate handles unix timestamp in seconds', () => {
	// Jan 7, 2026 12:00:00 UTC
	const timestamp = 1767787200
	const result = formatDate(timestamp, { style: 'date' })
	expect(result).toContain('2026')
})

test('formatDate handles Date object', () => {
	const date = new Date('2026-01-07T12:00:00Z')
	const result = formatDate(date, { style: 'date' })
	expect(result).toContain('2026')
})

test('formatDate short style returns abbreviated month', () => {
	const result = formatDate('2026-01-07T12:00:00Z', { style: 'short' })
	expect(result).toContain('Jan')
	expect(result).toContain('2026')
})

// formatRssDate tests

test('formatRssDate returns RFC 2822 format', () => {
	const date = new Date('2026-01-07T12:00:00Z')
	const result = formatRssDate(date)
	expect(result).toContain('Wed')
	expect(result).toContain('07 Jan 2026')
	expect(result).toContain('GMT')
})

// formatRelativeTime tests

test('formatRelativeTime returns Never for null', () => {
	expect(formatRelativeTime(null)).toBe('Never')
})

test('formatRelativeTime returns just now for recent times', () => {
	const now = new Date()
	expect(formatRelativeTime(now)).toBe('just now')
})

test('formatRelativeTime formats minutes ago', () => {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
	expect(formatRelativeTime(fiveMinutesAgo)).toBe('5 mins ago')
})

test('formatRelativeTime formats hours ago', () => {
	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
	expect(formatRelativeTime(threeHoursAgo)).toBe('3 hours ago')
})

test('formatRelativeTime formats days ago', () => {
	const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
	expect(formatRelativeTime(twoDaysAgo)).toBe('2 days ago')
})

test('formatRelativeTime handles unix timestamp in seconds', () => {
	const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
	expect(formatRelativeTime(oneHourAgo)).toBe('1 hour ago')
})
