const FEEDS_PREFIX = '/admin/feeds/'
const MEDIA_PREFIX = '/admin/media/'
const EDIT_SUFFIX = '/edit'

export function getFeedDetailPath(feedId: string): string {
	return `${FEEDS_PREFIX}${feedId}`
}

export function getFeedEditPath(feedId: string): string {
	return `${getFeedDetailPath(feedId)}${EDIT_SUFFIX}`
}

export function isFeedEditPath(pathname: string, feedId: string): boolean {
	return pathname === getFeedEditPath(feedId)
}

export function getMediaDetailPath(paramPath: string): string {
	return `${MEDIA_PREFIX}${paramPath}`
}

export function getMediaEditPath(paramPath: string): string {
	return `${getMediaDetailPath(paramPath)}${EDIT_SUFFIX}`
}

export function parseMediaDetailRoutePath(pathname: string): {
	paramPath: string
	isEditRoute: boolean
} {
	if (!pathname.startsWith(MEDIA_PREFIX)) {
		return { paramPath: '', isEditRoute: false }
	}

	const rawPath = pathname.slice(MEDIA_PREFIX.length)
	const isEditRoute =
		rawPath.endsWith(EDIT_SUFFIX) && rawPath.length > EDIT_SUFFIX.length
	const paramPath = isEditRoute
		? rawPath.slice(0, -EDIT_SUFFIX.length)
		: rawPath

	return { paramPath, isEditRoute }
}
