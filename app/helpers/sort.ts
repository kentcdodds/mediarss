import type { ISortByObjectSorter } from 'fast-sort'
import { sort as fastSort } from 'fast-sort'
import type { MediaFile } from './media.ts'

type SortDirection = 'asc' | 'desc'
type SortOption = ISortByObjectSorter<MediaFile>

/**
 * Parse a sort string into sort options.
 * Format: "direction:property,direction:property"
 * Example: "desc:publicationDate,asc:title"
 *
 * If direction is omitted, defaults to 'asc'.
 * Valid directions: 'asc', 'desc'
 */
function parseSortString(sortString: string): Array<SortOption> {
	return sortString
		.split(',')
		.filter(Boolean)
		.map((set) => {
			const parts = set.trim().split(':')
			let dir: SortDirection
			let prop: string

			if (parts.length === 1) {
				// No direction specified, default to asc
				dir = 'asc'
				prop = parts[0]!
			} else {
				const [dirPart, propPart] = parts
				if (dirPart !== 'asc' && dirPart !== 'desc') {
					throw new Error(
						`Invalid sort direction: ${dirPart}. Use 'asc' or 'desc'.`,
					)
				}
				dir = dirPart
				prop = propPart!
			}

			// Map property names to MediaFile properties
			const propMap: Record<string, keyof MediaFile> = {
				pubDate: 'publicationDate',
				publicationDate: 'publicationDate',
				title: 'title',
				author: 'author',
				filename: 'filename',
				filepath: 'path',
				path: 'path',
				duration: 'duration',
				size: 'sizeBytes',
				sizeBytes: 'sizeBytes',
				trackNumber: 'trackNumber',
				fileModifiedAt: 'fileModifiedAt',
			}

			const mappedProp = propMap[prop] ?? (prop as keyof MediaFile)

			const sorterFn = (item: MediaFile) => {
				const value = item[mappedProp]
				// Handle null/undefined values - sort them to the end
				if (value === null || value === undefined) {
					return dir === 'asc' ? Infinity : -Infinity
				}
				// Handle dates
				if (value instanceof Date) {
					return value.getTime()
				}
				// Handle strings - lowercase for case-insensitive sorting
				if (typeof value === 'string') {
					return value.toLowerCase()
				}
				return value
			}

			return (
				dir === 'asc' ? { asc: sorterFn } : { desc: sorterFn }
			) as SortOption
		})
}

/**
 * Ensure tiebreaker sort fields are included.
 * These ensure consistent ordering when primary sort fields are equal.
 */
function ensureTiebreakers(sortString: string): string {
	let result = sortString

	// Add tiebreakers if not already present
	if (!result.includes('title')) {
		result = `${result},asc:title`
	}
	if (!result.includes('author')) {
		result = `${result},asc:author`
	}
	if (
		!result.includes('filepath') &&
		!result.includes('path') &&
		!result.includes('filename')
	) {
		result = `${result},asc:filepath`
	}

	return result
}

/**
 * Sort media files based on a sort string.
 *
 * @param items - Array of media files to sort
 * @param sortString - Sort specification (e.g., "desc:pubDate,asc:title")
 * @returns New sorted array (original array is not modified)
 *
 * @example
 * // Sort by publication date descending, then by title ascending
 * sortMediaFiles(items, 'desc:pubDate,asc:title')
 *
 * @example
 * // Sort by track number ascending
 * sortMediaFiles(items, 'asc:trackNumber')
 */
export function sortMediaFiles(
	items: Array<MediaFile>,
	sortString: string,
): Array<MediaFile> {
	// Default sort if none specified
	if (!sortString) {
		sortString = 'asc:filename'
	}

	// Ensure tiebreakers are included
	const fullSortString = ensureTiebreakers(sortString)

	// Parse and apply sort
	const sortOptions = parseSortString(fullSortString)
	return fastSort([...items]).by(sortOptions)
}
