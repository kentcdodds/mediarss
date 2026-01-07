/**
 * Formatting utilities for dates, durations, file sizes, and relative times.
 * Consolidated from various UI components to avoid duplication.
 */

/**
 * Format duration in seconds to human-readable format.
 * Examples: "1h 23m", "45m 12s", "30s"
 *
 * @param seconds - Duration in seconds (or null)
 * @param options.showSeconds - Whether to show seconds when hours are present (default: false)
 * @param options.fallback - String to return for null/zero values (default: "—")
 */
export function formatDuration(
	seconds: number | null,
	options: { showSeconds?: boolean; fallback?: string } = {},
): string {
	const { showSeconds = false, fallback = '—' } = options

	if (seconds === null || seconds === 0) return fallback

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		if (showSeconds) {
			return `${hours}h ${minutes}m ${secs}s`
		}
		return `${hours}h ${minutes}m`
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`
	}
	return `${secs}s`
}

/**
 * Format duration in milliseconds to human-readable uptime format.
 * Examples: "2d 5h 30m", "3h 45m 12s", "5m 30s", "45s"
 *
 * Similar to formatDuration but accepts milliseconds and always shows all relevant units.
 */
export function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m`
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`
	}
	return `${seconds}s`
}

/**
 * Format duration in HH:MM:SS format for iTunes/podcast RSS feeds.
 * Examples: "1:23:45", "45:30"
 */
export function formatItunesDuration(seconds: number | null): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
		return ''
	}

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
	}
	return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format file size in bytes to human-readable format.
 * Examples: "1.2 GB", "456 MB", "12 KB", "500 B"
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B'

	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	const k = 1024
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	const size = bytes / Math.pow(k, i)

	return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Format a date to a readable string.
 *
 * @param date - Date object, ISO string, or unix timestamp (seconds)
 * @param options.style - Formatting style:
 *   - 'full': "January 7, 2026, 10:30:45 AM"
 *   - 'date': "January 7, 2026"
 *   - 'short': "Jan 7, 2026"
 *   - 'datetime': "Jan 7, 2026, 10:30:45 AM"
 */
export function formatDate(
	date: Date | string | number | null,
	options: { style?: 'full' | 'date' | 'short' | 'datetime' } = {},
): string {
	const { style = 'datetime' } = options
	if (date === null) return '—'

	let dateObj: Date
	if (typeof date === 'number') {
		// Assume unix timestamp in seconds if < year 3000 in ms
		dateObj = date < 100000000000 ? new Date(date * 1000) : new Date(date)
	} else if (typeof date === 'string') {
		dateObj = new Date(date)
	} else {
		dateObj = date
	}

	if (Number.isNaN(dateObj.getTime())) return '—'

	switch (style) {
		case 'full':
			return dateObj.toLocaleString(undefined, {
				dateStyle: 'long',
				timeStyle: 'medium',
			})
		case 'date':
			return dateObj.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		case 'short':
			return dateObj.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		case 'datetime':
			return dateObj.toLocaleString(undefined, {
				dateStyle: 'medium',
				timeStyle: 'medium',
			})
	}
}

/**
 * Format a date as RFC 2822 for RSS feeds.
 * Example: "Tue, 07 Jan 2026 15:30:45 GMT"
 */
export function formatRssDate(date: Date): string {
	return date.toUTCString()
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago").
 *
 * @param date - Date object, ISO string, or unix timestamp (seconds)
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(
	date: Date | string | number | null,
): string {
	if (date === null) return 'Never'

	let dateObj: Date
	if (typeof date === 'number') {
		// Assume unix timestamp in seconds if < year 3000 in ms
		dateObj = date < 100000000000 ? new Date(date * 1000) : new Date(date)
	} else if (typeof date === 'string') {
		dateObj = new Date(date)
	} else {
		dateObj = date
	}

	if (Number.isNaN(dateObj.getTime())) return '—'

	const now = Date.now()
	const diff = now - dateObj.getTime()

	// Handle future dates
	if (diff < 0) return 'just now'

	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)
	const weeks = Math.floor(days / 7)
	const months = Math.floor(days / 30)

	if (seconds < 60) return 'just now'
	if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`
	if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
	if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
	if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`
	return `${months} month${months !== 1 ? 's' : ''} ago`
}
