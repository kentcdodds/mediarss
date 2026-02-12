import { expect, test } from 'bun:test'
import { parseAnalyticsWindowDays } from './analytics-window.ts'

function createRequest(search = ''): Request {
	return new Request(`http://localhost/admin/api/analytics${search}`)
}

test('parseAnalyticsWindowDays returns default when param missing', () => {
	const days = parseAnalyticsWindowDays(createRequest())
	expect(days).toBe(30)
})

test('parseAnalyticsWindowDays accepts positive integer values', () => {
	expect(parseAnalyticsWindowDays(createRequest('?days=7'))).toBe(7)
	expect(parseAnalyticsWindowDays(createRequest('?days=30'))).toBe(30)
	expect(parseAnalyticsWindowDays(createRequest('?days=365'))).toBe(365)
})

test('parseAnalyticsWindowDays clamps values to max', () => {
	const days = parseAnalyticsWindowDays(createRequest('?days=9999'))
	expect(days).toBe(365)
	const hugeDays = parseAnalyticsWindowDays(
		createRequest('?days=999999999999999999999999999'),
	)
	expect(hugeDays).toBe(365)
})

test('parseAnalyticsWindowDays rejects invalid numeric formats', () => {
	expect(parseAnalyticsWindowDays(createRequest('?days=0'))).toBe(30)
	expect(parseAnalyticsWindowDays(createRequest('?days=-5'))).toBe(30)
	expect(parseAnalyticsWindowDays(createRequest('?days=7.5'))).toBe(30)
	expect(parseAnalyticsWindowDays(createRequest('?days=30abc'))).toBe(30)
	expect(parseAnalyticsWindowDays(createRequest('?days=abc'))).toBe(30)
})

test('parseAnalyticsWindowDays supports custom option values', () => {
	const request = createRequest('?window=14')
	const days = parseAnalyticsWindowDays(request, {
		queryParam: 'window',
		defaultDays: 10,
		maxDays: 90,
	})
	expect(days).toBe(14)
})

test('parseAnalyticsWindowDays normalizes invalid option values safely', () => {
	const request = createRequest('?days=20')

	expect(
		parseAnalyticsWindowDays(request, {
			defaultDays: 0,
			maxDays: 0,
		}),
	).toBe(20)

	expect(
		parseAnalyticsWindowDays(createRequest(), {
			defaultDays: Number.NaN,
			maxDays: Number.NaN,
		}),
	).toBe(30)

	expect(
		parseAnalyticsWindowDays(createRequest(), {
			defaultDays: 90,
			maxDays: 30,
		}),
	).toBe(30)
})
