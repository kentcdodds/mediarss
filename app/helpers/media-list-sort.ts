const textCollator = new Intl.Collator(undefined, {
	sensitivity: 'base',
	numeric: true,
})

export const MEDIA_SORT_OPTIONS = [
	{ value: 'recently-modified', label: 'Recently added/modified' },
	{ value: 'most-popular', label: 'Popularity' },
	{ value: 'least-recently-modified', label: 'Least recently modified' },
	{ value: 'publication-date-newest', label: 'Publication date (newest)' },
	{ value: 'publication-date-oldest', label: 'Publication date (oldest)' },
	{ value: 'title-az', label: 'Title (A-Z)' },
	{ value: 'author-az', label: 'Author (A-Z)' },
	{ value: 'largest-first', label: 'Largest files' },
] as const

export type MediaSortBy = (typeof MEDIA_SORT_OPTIONS)[number]['value']

type SortableMediaItem = {
	path: string
	rootName: string
	relativePath: string
	title: string
	author: string | null
	filename: string
	sizeBytes: number
	duration: number | null
	publicationDate: string | null
	fileModifiedAt: number
	mediaRequests?: number
	downloadStarts?: number
	uniqueClients?: number
}

function compareText(a: string, b: string): number {
	return textCollator.compare(a, b)
}

function compareNullableTextAsc(a: string | null, b: string | null): number {
	if (a === null && b === null) return 0
	if (a === null) return 1
	if (b === null) return -1
	return compareText(a, b)
}

function compareNullableDateAsc(a: string | null, b: string | null): number {
	if (a === null && b === null) return 0
	if (a === null) return 1
	if (b === null) return -1
	return a.localeCompare(b)
}

function compareNullableDateDesc(a: string | null, b: string | null): number {
	if (a === null && b === null) return 0
	if (a === null) return 1
	if (b === null) return -1
	return b.localeCompare(a)
}

function compareStable(a: SortableMediaItem, b: SortableMediaItem): number {
	const titleComparison = compareText(a.title, b.title)
	if (titleComparison !== 0) return titleComparison

	const authorComparison = compareNullableTextAsc(a.author, b.author)
	if (authorComparison !== 0) return authorComparison

	const filenameComparison = compareText(a.filename, b.filename)
	if (filenameComparison !== 0) return filenameComparison

	const rootComparison = compareText(a.rootName, b.rootName)
	if (rootComparison !== 0) return rootComparison

	const relativePathComparison = compareText(a.relativePath, b.relativePath)
	if (relativePathComparison !== 0) return relativePathComparison

	return compareText(a.path, b.path)
}

export function sortMediaItems<T extends SortableMediaItem>(
	items: Array<T>,
	sortBy: MediaSortBy,
): Array<T> {
	return [...items].sort((a, b) => {
		switch (sortBy) {
			case 'recently-modified': {
				if (b.fileModifiedAt !== a.fileModifiedAt) {
					return b.fileModifiedAt - a.fileModifiedAt
				}
				return compareStable(a, b)
			}
			case 'most-popular': {
				const downloadStartsA = a.downloadStarts ?? 0
				const downloadStartsB = b.downloadStarts ?? 0
				if (downloadStartsB !== downloadStartsA) {
					return downloadStartsB - downloadStartsA
				}
				const mediaRequestsA = a.mediaRequests ?? 0
				const mediaRequestsB = b.mediaRequests ?? 0
				if (mediaRequestsB !== mediaRequestsA) {
					return mediaRequestsB - mediaRequestsA
				}
				const uniqueClientsA = a.uniqueClients ?? 0
				const uniqueClientsB = b.uniqueClients ?? 0
				if (uniqueClientsB !== uniqueClientsA) {
					return uniqueClientsB - uniqueClientsA
				}
				if (b.fileModifiedAt !== a.fileModifiedAt) {
					return b.fileModifiedAt - a.fileModifiedAt
				}
				return compareStable(a, b)
			}
			case 'least-recently-modified': {
				if (a.fileModifiedAt !== b.fileModifiedAt) {
					return a.fileModifiedAt - b.fileModifiedAt
				}
				return compareStable(a, b)
			}
			case 'publication-date-newest': {
				const publicationDateComparison = compareNullableDateDesc(
					a.publicationDate,
					b.publicationDate,
				)
				if (publicationDateComparison !== 0) return publicationDateComparison
				if (b.fileModifiedAt !== a.fileModifiedAt) {
					return b.fileModifiedAt - a.fileModifiedAt
				}
				return compareStable(a, b)
			}
			case 'publication-date-oldest': {
				const publicationDateComparison = compareNullableDateAsc(
					a.publicationDate,
					b.publicationDate,
				)
				if (publicationDateComparison !== 0) return publicationDateComparison
				if (a.fileModifiedAt !== b.fileModifiedAt) {
					return a.fileModifiedAt - b.fileModifiedAt
				}
				return compareStable(a, b)
			}
			case 'title-az':
				return compareStable(a, b)
			case 'author-az': {
				const authorComparison = compareNullableTextAsc(a.author, b.author)
				if (authorComparison !== 0) return authorComparison
				return compareStable(a, b)
			}
			case 'largest-first': {
				if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes
				if (b.duration !== a.duration) {
					return (
						(b.duration ?? Number.NEGATIVE_INFINITY) -
						(a.duration ?? Number.NEGATIVE_INFINITY)
					)
				}
				return compareStable(a, b)
			}
			default:
				return compareStable(a, b)
		}
	})
}
