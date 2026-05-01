import { parseMediaPath, toAbsolutePath } from '#app/config/env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import {
	createCuratedFeed,
	deleteCuratedFeed,
	getCuratedFeedById,
	updateCuratedFeed,
} from '#app/db/curated-feeds.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
	getDirectoryFeedById,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import {
	addItemToFeed,
	clearFeedItems,
	removeItemFromFeed,
} from '#app/db/feed-items.ts'
import { isDirectoryFeed, type Feed, type FeedType } from '#app/db/types.ts'
import { buttonStyle, cardStyle } from './admin-styles.ts'
import {
	AdminFormError,
	getAllStringValues,
	getLineValues,
	getOptionalString,
	getRequiredString,
	redirect303,
	renderAdminPage,
} from './admin-utils.tsx'

type FormFeedData = {
	name: string
	description: string
	subtitle: string | null
	sortFields: string
	sortOrder: 'asc' | 'desc'
	feedType: FeedType
	link: string | null
	copyright: string | null
}

export async function handleAdminPost(request: Request) {
	try {
		const formData = await request.formData()
		const action = getRequiredString(formData, '_action')

		switch (action) {
			case 'create-directory-feed':
				return await createDirectoryFeedFromForm(formData)
			case 'create-curated-feed':
				return await createCuratedFeedFromForm(formData)
			case 'update-feed':
				return await updateFeedFromForm(formData)
			case 'delete-feed':
				return await deleteFeedFromForm(formData)
			case 'create-token':
				return await createTokenFromForm(formData)
			case 'add-item':
				return await addItemFromForm(formData)
			case 'remove-item':
				return await removeItemFromForm(formData)
			case 'clear-items':
				return await clearItemsFromForm(formData)
			default:
				return renderAdminPage({
					title: 'Unsupported action',
					body: (
						<section mix={cardStyle}>
							<h2>Unsupported action</h2>
							<p>Unknown admin form action: {action}</p>
							<a href="/admin" mix={buttonStyle}>
								Back to admin
							</a>
						</section>
					),
					status: 400,
				})
		}
	} catch (error) {
		if (isAdminFormError(error)) {
			return invalidForm(error.message, error.href)
		}
		throw error
	}
}

async function getFeed(feedId: string): Promise<Feed | undefined> {
	return (
		(await getDirectoryFeedById(feedId)) ?? (await getCuratedFeedById(feedId))
	)
}

async function getFeedOrThrow(feedId: string): Promise<Feed> {
	const feed = await getFeed(feedId)
	if (!feed) {
		throw new AdminFormError('Unknown feed.', '/admin')
	}
	return feed
}

async function createDirectoryFeedFromForm(formData: FormData) {
	const feedData = getFormFeedData(formData, 'filename')
	const directoryPaths = validateDirectoryPaths(
		getLineValues(formData, 'directoryPaths'),
		'/admin/feeds/new',
	)
	const feed = await createDirectoryFeed({ ...feedData, directoryPaths })
	await createDirectoryFeedToken({ feedId: feed.id, label: 'Default' })
	return redirect303(`/admin/feeds/${feed.id}`)
}

async function createCuratedFeedFromForm(formData: FormData) {
	const feedData = getFormFeedData(formData, 'position')
	const feed = await createCuratedFeed(feedData)
	await createCuratedFeedToken({ feedId: feed.id, label: 'Default' })
	for (const mediaPath of getAllStringValues(formData, 'items')) {
		const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
		await addItemToFeed(feed.id, mediaRoot, relativePath)
	}
	return redirect303(`/admin/feeds/${feed.id}`)
}

async function updateFeedFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feed = await getFeedOrThrow(feedId)
	const feedData = getFormFeedData(
		formData,
		isDirectoryFeed(feed) ? 'filename' : 'position',
	)

	if (isDirectoryFeed(feed)) {
		await updateDirectoryFeed(feedId, {
			...feedData,
			directoryPaths: validateDirectoryPaths(
				getLineValues(formData, 'directoryPaths'),
				`/admin/feeds/${feedId}`,
			),
		})
	} else {
		await updateCuratedFeed(feedId, feedData)
	}

	return redirect303(`/admin/feeds/${feedId}`)
}

async function deleteFeedFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feed = await getFeedOrThrow(feedId)

	if (isDirectoryFeed(feed)) {
		await deleteDirectoryFeed(feedId)
	} else {
		await deleteCuratedFeed(feedId)
	}

	return redirect303('/admin')
}

async function createTokenFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feed = await getFeedOrThrow(feedId)
	const label = getOptionalString(formData, 'label') ?? 'Manual token'

	if (isDirectoryFeed(feed)) {
		await createDirectoryFeedToken({ feedId, label })
	} else {
		await createCuratedFeedToken({ feedId, label })
	}

	return redirect303(`/admin/feeds/${feedId}`)
}

async function addItemFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const mediaPath = getRequiredString(formData, 'mediaPath')
	const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
	await addItemToFeed(feedId, mediaRoot, relativePath)
	return redirect303(`/admin/feeds/${feedId}`)
}

async function removeItemFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const mediaPath = getRequiredString(formData, 'mediaPath')
	const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
	await removeItemFromFeed(feedId, mediaRoot, relativePath)
	return redirect303(`/admin/feeds/${feedId}`)
}

async function clearItemsFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	await clearFeedItems(feedId)
	return redirect303(`/admin/feeds/${feedId}`)
}

function getFormFeedData(
	formData: FormData,
	defaultSortFields: string,
): FormFeedData {
	return {
		name: getRequiredString(formData, 'name').trim(),
		description: getOptionalString(formData, 'description') ?? '',
		subtitle: getOptionalString(formData, 'subtitle'),
		sortFields: getOptionalString(formData, 'sortFields') ?? defaultSortFields,
		sortOrder: getSortOrder(formData),
		feedType: getFeedType(formData),
		link: getOptionalString(formData, 'link'),
		copyright: getOptionalString(formData, 'copyright'),
	}
}

function getSortOrder(formData: FormData): 'asc' | 'desc' {
	const value = getOptionalString(formData, 'sortOrder')
	return value === 'desc' ? 'desc' : 'asc'
}

function getFeedType(formData: FormData): FeedType {
	const value = getOptionalString(formData, 'feedType')
	return value === 'serial' ? 'serial' : 'episodic'
}

function validateDirectoryPaths(paths: Array<string>, href: string) {
	if (paths.length === 0) {
		throw new AdminFormError('Directory paths are required.', href)
	}
	for (const path of paths) {
		const { mediaRoot } = parseMediaPath(path)
		if (!mediaRoot.trim()) {
			throw new AdminFormError(
				'Each directory path must include a media root name.',
				href,
			)
		}
		if (!toAbsolutePath(mediaRoot, '')) {
			throw new AdminFormError(`Unknown media root "${mediaRoot}".`, href)
		}
	}
	return paths
}

function invalidForm(message: string, href: string) {
	return renderAdminPage({
		title: 'Invalid form',
		body: (
			<section mix={cardStyle}>
				<h1>Invalid form</h1>
				<p>{message}</p>
				<a href={href} mix={buttonStyle}>
					Back
				</a>
			</section>
		),
		status: 400,
	})
}

function isAdminFormError(error: unknown): error is AdminFormError {
	return (
		error instanceof AdminFormError ||
		(error instanceof Error && error.name === 'AdminFormError')
	)
}
