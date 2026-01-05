import type { MediaFile } from './media.ts'

/**
 * Filter configuration for feed items.
 * Format: "regex:property,regex:property" (comma-separated, all must match)
 */
export type FilterConfig = {
	filterIn?: string | null
	filterOut?: string | null
}

/**
 * Parse a filter string into filter options.
 * Format: "regex:property,regex:property"
 * Example: "Harry:title,Rowling:author"
 */
function parseFilterString(
	filterString: string,
): Array<{ regex: RegExp; prop: string }> {
	return filterString
		.split(',')
		.filter(Boolean)
		.map((set) => {
			const colonIndex = set.lastIndexOf(':')
			if (colonIndex === -1) {
				// No property specified, default to matching against title
				return { regex: new RegExp(set, 'im'), prop: 'title' }
			}
			const regexString = set.slice(0, colonIndex)
			const prop = set.slice(colonIndex + 1)
			return { regex: new RegExp(regexString, 'im'), prop }
		})
}

/**
 * Get a property value from a media file as a string for regex matching.
 */
function getPropertyValue(item: MediaFile, prop: string): string {
	const value = item[prop as keyof MediaFile]
	if (value === null || value === undefined) {
		return ''
	}
	if (typeof value === 'string') {
		return value
	}
	if (value instanceof Date) {
		return value.toISOString()
	}
	return JSON.stringify(value)
}

/**
 * Check if an item matches all filter options.
 */
function matchesFilter(
	item: MediaFile,
	filterOptions: Array<{ regex: RegExp; prop: string }>,
): boolean {
	return filterOptions.every(({ regex, prop }) => {
		const value = getPropertyValue(item, prop)
		return regex.test(value)
	})
}

/**
 * Filter media files based on filterIn and filterOut patterns.
 *
 * - filterIn: Include only items that match ALL patterns
 * - filterOut: Exclude items that match ALL patterns
 *
 * @param items - Array of media files to filter
 * @param config - Filter configuration with filterIn and filterOut patterns
 * @returns Filtered array of media files
 */
export function filterMediaFiles(
	items: Array<MediaFile>,
	config: FilterConfig,
): Array<MediaFile> {
	let filteredItems: Array<MediaFile> = []

	// Apply filterIn
	if (config.filterIn) {
		const filterInOptions = parseFilterString(config.filterIn)
		for (const item of items) {
			if (matchesFilter(item, filterInOptions)) {
				filteredItems.push(item)
			}
		}
	} else {
		// No filterIn means include all items
		filteredItems = [...items]
	}

	// Apply filterOut
	if (config.filterOut) {
		const filterOutOptions = parseFilterString(config.filterOut)
		filteredItems = filteredItems.filter(
			(item) => !matchesFilter(item, filterOutOptions),
		)
	}

	return filteredItems
}
