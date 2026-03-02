export const FEED_SORT_OPTIONS = [
	{ value: 'most-popular', label: 'Most popular' },
	{ value: 'most-items', label: 'Most files' },
	{ value: 'recently-accessed', label: 'Recently accessed' },
	{ value: 'recently-updated', label: 'Recently updated' },
	{ value: 'newest', label: 'Newest first' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'name-az', label: 'Name (A-Z)' },
] as const

export type FeedSortBy = (typeof FEED_SORT_OPTIONS)[number]['value']

type SortableFeed = {
	id: string
	name: string
	tokenCount: number
	itemCount: number
	lastAccessedAt: number | null
	createdAt: number
	updatedAt: number
}

const nameCollator = new Intl.Collator(undefined, {
	sensitivity: 'base',
	numeric: true,
})

function compareByName(a: SortableFeed, b: SortableFeed): number {
	return nameCollator.compare(a.name, b.name)
}

function compareNullableNumberDesc(a: number | null, b: number | null): number {
	const normalizedA = a ?? Number.NEGATIVE_INFINITY
	const normalizedB = b ?? Number.NEGATIVE_INFINITY
	return normalizedB - normalizedA
}

/**
 * Stable fallback so sorting is deterministic for equal values.
 */
function compareStable(a: SortableFeed, b: SortableFeed): number {
	const nameComparison = compareByName(a, b)
	if (nameComparison !== 0) return nameComparison
	return a.id.localeCompare(b.id)
}

export function sortFeeds<T extends SortableFeed>(
	feeds: Array<T>,
	sortBy: FeedSortBy,
): Array<T> {
	return [...feeds].sort((a, b) => {
		switch (sortBy) {
			case 'most-popular': {
				if (b.tokenCount !== a.tokenCount) {
					return b.tokenCount - a.tokenCount
				}
				const lastAccessedComparison = compareNullableNumberDesc(
					a.lastAccessedAt,
					b.lastAccessedAt,
				)
				if (lastAccessedComparison !== 0) return lastAccessedComparison
				if (b.itemCount !== a.itemCount) {
					return b.itemCount - a.itemCount
				}
				if (b.createdAt !== a.createdAt) {
					return b.createdAt - a.createdAt
				}
				return compareStable(a, b)
			}
			case 'most-items': {
				if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount
				if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount
				return compareStable(a, b)
			}
			case 'recently-accessed': {
				const lastAccessedComparison = compareNullableNumberDesc(
					a.lastAccessedAt,
					b.lastAccessedAt,
				)
				if (lastAccessedComparison !== 0) return lastAccessedComparison
				if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount
				if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
				return compareStable(a, b)
			}
			case 'recently-updated': {
				if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
				if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount
				return compareStable(a, b)
			}
			case 'newest': {
				if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
				return compareStable(a, b)
			}
			case 'oldest': {
				if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
				return compareStable(a, b)
			}
			case 'name-az':
				return compareStable(a, b)
			default:
				return compareStable(a, b)
		}
	})
}
