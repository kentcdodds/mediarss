import { type Handle, css as rmxCss, on as rmxOn } from 'remix/component'
import {
	Modal,
	ModalAlert,
	ModalButton,
	ModalFooter,
} from '#app/components/modal.tsx'
import {
	formatDate,
	formatDuration,
	formatFileSize,
	formatRelativeTime,
} from '#app/helpers/format.ts'
import {
	artworkLayout,
	colors,
	mq,
	radius,
	responsive,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'
import { AnalyticsDailyActivityChart } from './analytics-daily-activity-chart.tsx'
import { AnalyticsMetricCard } from './analytics-metric-card.tsx'
import { AnalyticsTopClientsList } from './analytics-top-clients-list.tsx'
import {
	getFeedDetailPath,
	getFeedEditPath,
	isFeedEditPath,
} from './edit-route-paths.ts'
import { router } from './router.tsx'

type DirectoryFeed = {
	id: string
	name: string
	description: string
	subtitle: string | null
	directoryPaths: string // JSON array of "mediaRoot:relativePath" strings
	sortFields: string
	sortOrder: 'asc' | 'desc'
	// Nullable in DB/API for legacy feeds; UI defaults to 'episodic' when missing.
	feedType: ('episodic' | 'serial') | null
	link: string | null
	copyright: string | null
	author: string | null
	ownerName: string | null
	ownerEmail: string | null
	type: 'directory'
	createdAt: number
	updatedAt: number
}

type CuratedFeed = {
	id: string
	name: string
	description: string
	subtitle: string | null
	sortFields: string
	sortOrder: 'asc' | 'desc'
	// Nullable in DB/API for legacy feeds; UI defaults to 'episodic' when missing.
	feedType: ('episodic' | 'serial') | null
	link: string | null
	copyright: string | null
	author: string | null
	ownerName: string | null
	ownerEmail: string | null
	type: 'curated'
	createdAt: number
	updatedAt: number
}

type Feed = DirectoryFeed | CuratedFeed

type Token = {
	token: string
	feedId: string
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
}

type MediaItem = {
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	filename: string
	mediaRoot: string
	relativePath: string
	publicationDate: string | null // ISO string
	trackNumber: number | null
	fileModifiedAt: number // Unix timestamp
}

/**
 * Convert mediaRoot and relativePath to mediaRoot:relativePath format
 */
function toMediaPath(item: MediaItem): string {
	return item.relativePath
		? `${item.mediaRoot}:${item.relativePath}`
		: item.mediaRoot
}

/**
 * Determines if the sort field needs an extra column that's not in the default columns.
 * Default columns: title, author, duration, size
 */
function getExtraSortColumn(sortFields: string): string | null {
	const defaultColumns = ['title', 'author', 'duration', 'size', 'position']
	if (defaultColumns.includes(sortFields)) {
		return null
	}
	return sortFields
}

/**
 * Format a value for display in the extra sort column
 */
function formatSortValue(item: MediaItem, sortField: string): string {
	switch (sortField) {
		case 'publicationDate':
			if (!item.publicationDate) return '—'
			return new Date(item.publicationDate).toLocaleDateString('en-US', {
				year: '2-digit',
				month: 'numeric',
				day: 'numeric',
			})
		case 'trackNumber':
			return item.trackNumber?.toString() ?? '—'
		case 'filename':
			return item.filename
		case 'fileModifiedAt':
			if (!item.fileModifiedAt) return '—'
			return new Date(item.fileModifiedAt * 1000).toLocaleDateString('en-US', {
				year: '2-digit',
				month: 'numeric',
				day: 'numeric',
			})
		default:
			return '—'
	}
}

/**
 * Get a human-readable label for a sort field
 */
function getSortFieldLabel(sortField: string): string {
	const labels: Record<string, string> = {
		publicationDate: 'Date',
		trackNumber: 'Track',
		filename: 'File',
		fileModifiedAt: 'Modified',
	}
	return labels[sortField] ?? sortField
}

type FeedResponse = {
	feed: Feed
	tokens: Array<Token>
	items: Array<MediaItem>
	hasUploadedArtwork: boolean
}

type FeedAnalyticsSummary = {
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
}

type FeedTokenAnalytics = FeedAnalyticsSummary & {
	token: string
	label: string
	createdAt: number | null
	lastUsedAt: number | null
	revokedAt: number | null
	firstSeenAt: number | null
	lastSeenAt: number | null
}

type FeedTopMediaAnalytics = {
	mediaRoot: string
	relativePath: string
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
	lastSeenAt: number | null
}

type FeedTopClientAnalytics = {
	clientName: string
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
	firstSeenAt: number | null
	lastSeenAt: number | null
}

type FeedDailyAnalytics = FeedAnalyticsSummary & {
	day: string
	dayStart: number
}

type FeedAnalyticsResponse = {
	feed: {
		id: string
		name: string
		type: 'directory' | 'curated'
	}
	windowDays: number
	since: number
	summary: FeedAnalyticsSummary
	byToken: Array<FeedTokenAnalytics>
	topMediaItems: Array<FeedTopMediaAnalytics>
	topClients: Array<FeedTopClientAnalytics>
	daily: Array<FeedDailyAnalytics>
}

type AnalyticsLoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: FeedAnalyticsResponse }

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: FeedResponse }

type EditFormState = {
	name: string
	description: string
	subtitle: string
	author: string
	ownerName: string
	ownerEmail: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
	feedType: 'episodic' | 'serial'
	link: string
	copyright: string
	directoryPaths: Array<string> // Only used for directory feeds
}

type MediaRoot = {
	name: string
	path: string
}

type DirectoryEntry = {
	name: string
	type: 'directory' | 'file'
}

type RootsState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; roots: Array<MediaRoot> }

type BrowseState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; entries: Array<DirectoryEntry> }

/**
 * FeedDetail component - displays feed information and manages tokens.
 */
export function FeedDetail(handle: Handle) {
	let state: LoadingState = { status: 'loading' }
	let analyticsState: AnalyticsLoadingState = { status: 'loading' }
	let analyticsRequestId = 0
	let copiedToken: string | null = null
	let showCreateForm = false
	let newTokenLabel = ''
	let createLoading = false
	let feedId = ''
	let analyticsWindowDays = 30

	const fetchAnalytics = (id: string, windowDays: number) => {
		analyticsRequestId += 1
		const requestId = analyticsRequestId
		analyticsState = { status: 'loading' }
		handle.update()

		fetch(`/admin/api/feeds/${id}/analytics?days=${windowDays}`, {
			signal: handle.signal,
		})
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<FeedAnalyticsResponse>
			})
			.then((data) => {
				if (requestId !== analyticsRequestId) return
				analyticsState = { status: 'success', data }
				handle.update()
			})
			.catch((err) => {
				if (handle.signal.aborted) return
				if (requestId !== analyticsRequestId) return
				analyticsState = { status: 'error', message: err.message }
				handle.update()
			})
	}

	// Feed edit form state
	let editForm: EditFormState = {
		name: '',
		description: '',
		subtitle: '',
		author: '',
		ownerName: '',
		ownerEmail: '',
		sortFields: '',
		sortOrder: 'asc',
		feedType: 'episodic',
		link: '',
		copyright: '',
		directoryPaths: [],
	}
	let editLoading = false
	let editError: string | null = null
	let editFormSeed = ''

	// Delete confirmation state
	let showDeleteConfirm = false
	let deleteLoading = false

	// Item management state (curated feeds only)
	let showAddFilesModal = false
	let itemActionLoading = false

	// Drag-and-drop state
	let draggingIndex: number | null = null
	let dragOverIndex: number | null = null

	// File picker state
	let rootsState: RootsState = { status: 'loading' }
	let browseState: BrowseState = { status: 'idle' }
	let pickerRoot: string | null = null
	let pickerPath = ''
	let selectedFilePaths: Array<string> = []

	// Artwork management state
	let artworkUploadLoading = false
	let artworkDeleteLoading = false
	let artworkError: string | null = null
	let artworkImageKey = 0 // Used to force image refresh after upload

	// Fetch media roots for file picker
	fetch('/admin/api/directories', { signal: handle.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<{ roots: Array<MediaRoot> }>
		})
		.then((data) => {
			rootsState = { status: 'success', roots: data.roots }
			handle.update()
		})
		.catch((err) => {
			if (handle.signal.aborted) return
			rootsState = { status: 'error', message: err.message }
			handle.update()
		})

	// Browse a directory for the file picker
	const browse = (rootName: string, path: string) => {
		browseState = { status: 'loading' }
		handle.update()

		const params = new URLSearchParams({ root: rootName, path })
		fetch(`/admin/api/browse?${params}`, { signal: handle.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<{ entries: Array<DirectoryEntry> }>
			})
			.then((data) => {
				browseState = { status: 'success', entries: data.entries }
				handle.update()
			})
			.catch((err) => {
				if (handle.signal.aborted) return
				browseState = { status: 'error', message: err.message }
				handle.update()
			})
	}

	const selectPickerRoot = (rootName: string) => {
		if (rootsState.status !== 'success') return
		pickerRoot = rootName
		pickerPath = ''
		browse(rootName, '')
	}

	const navigatePickerToDir = (dirName: string) => {
		if (!pickerRoot) return
		const newPath = pickerPath ? `${pickerPath}/${dirName}` : dirName
		pickerPath = newPath
		browse(pickerRoot, newPath)
	}

	const navigatePickerUp = () => {
		if (!pickerRoot || !pickerPath) return
		const parts = pickerPath.split('/')
		parts.pop()
		pickerPath = parts.join('/')
		browse(pickerRoot, pickerPath)
	}

	const getMediaPathForFile = (filename: string): string | null => {
		if (!pickerRoot) return null
		const relativePath = pickerPath ? `${pickerPath}/${filename}` : filename
		return relativePath ? `${pickerRoot}:${relativePath}` : pickerRoot
	}

	const toggleFileSelection = (
		filename: string,
		currentItems: Array<MediaItem>,
	) => {
		const mediaPath = getMediaPathForFile(filename)
		if (!mediaPath) return

		const existingIndex = selectedFilePaths.indexOf(mediaPath)
		if (existingIndex >= 0) {
			selectedFilePaths.splice(existingIndex, 1)
		} else {
			// Don't allow selecting files already in the feed
			if (!currentItems.some((item) => toMediaPath(item) === mediaPath)) {
				selectedFilePaths.push(mediaPath)
			}
		}
		handle.update()
	}

	const isFileSelected = (filename: string): boolean => {
		const mediaPath = getMediaPathForFile(filename)
		return mediaPath ? selectedFilePaths.includes(mediaPath) : false
	}

	const isFileInFeed = (
		filename: string,
		currentItems: Array<MediaItem>,
	): boolean => {
		const mediaPath = getMediaPathForFile(filename)
		return mediaPath
			? currentItems.some((item) => toMediaPath(item) === mediaPath)
			: false
	}

	const openAddFilesModal = () => {
		showAddFilesModal = true
		selectedFilePaths = []
		pickerPath = ''
		browseState = { status: 'idle' }
		handle.update()

		// Auto-select first root and browse it
		if (rootsState.status === 'success' && rootsState.roots.length > 0) {
			const firstRoot = rootsState.roots[0]
			if (firstRoot) {
				pickerRoot = firstRoot.name
				browse(firstRoot.name, '')
			}
		} else {
			pickerRoot = null
		}
	}

	const closeAddFilesModal = () => {
		showAddFilesModal = false
		selectedFilePaths = []
		handle.update()
	}

	const confirmAddFiles = async () => {
		if (selectedFilePaths.length === 0) return
		await addItems(selectedFilePaths)
		selectedFilePaths = []
	}

	const fetchFeed = (id: string) => {
		feedId = id
		state = { status: 'loading' }
		analyticsState = { status: 'loading' }
		handle.update()

		fetch(`/admin/api/feeds/${id}`, { signal: handle.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<FeedResponse>
			})
			.then((data) => {
				state = { status: 'success', data }
				// Use feed's updatedAt as cache buster for artwork
				artworkImageKey = data.feed.updatedAt
				artworkError = null
				fetchAnalytics(id, analyticsWindowDays)
				handle.update()
			})
			.catch((err) => {
				if (handle.signal.aborted) return
				state = { status: 'error', message: err.message }
				handle.update()
			})
	}

	const copyFeedUrl = async (token: string) => {
		const url = `${window.location.origin}/feed/${token}`
		try {
			await navigator.clipboard.writeText(url)
			copiedToken = token
			handle.update()
			setTimeout(() => {
				copiedToken = null
				handle.update()
			}, 2000)
		} catch {
			console.error('Failed to copy to clipboard text:', url)
		}
	}

	const createToken = async () => {
		createLoading = true
		handle.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/tokens`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: newTokenLabel.trim() || undefined }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)

			// Refresh the feed data to get the new token
			newTokenLabel = ''
			showCreateForm = false
			fetchFeed(feedId)
		} catch (err) {
			console.error('Failed to create token:', err)
		} finally {
			createLoading = false
			handle.update()
		}
	}

	const revokeToken = async (token: string) => {
		try {
			const res = await fetch(`/admin/api/tokens/${token}`, {
				method: 'DELETE',
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)

			// Refresh the feed data
			fetchFeed(feedId)
		} catch (err) {
			console.error('Failed to revoke token:', err)
		}
	}

	const syncEditFormWithFeed = (feed: Feed) => {
		let directoryPaths: Array<string> = []
		if ('directoryPaths' in feed) {
			try {
				directoryPaths = JSON.parse(feed.directoryPaths) as Array<string>
			} catch {
				directoryPaths = []
			}
		}
		editForm = {
			name: feed.name,
			description: feed.description,
			subtitle: feed.subtitle ?? '',
			author: feed.author ?? '',
			ownerName: feed.ownerName ?? '',
			ownerEmail: feed.ownerEmail ?? '',
			sortFields: feed.sortFields,
			sortOrder: feed.sortOrder,
			feedType: feed.feedType ?? 'episodic',
			link: feed.link ?? '',
			copyright: feed.copyright ?? '',
			directoryPaths,
		}
		editError = null
		editFormSeed = `${feed.id}:${feed.updatedAt}`
	}

	const cancelEditing = () => {
		editError = null
		router.navigate(getFeedDetailPath(feedId))
	}

	const saveEdit = async (isDirectory: boolean) => {
		if (!editForm.name.trim()) {
			editError = 'Name is required'
			handle.update()
			return
		}

		if (isDirectory && editForm.directoryPaths.length === 0) {
			editError = 'At least one directory is required'
			handle.update()
			return
		}

		editLoading = true
		editError = null
		handle.update()

		try {
			const body: Record<string, unknown> = {
				name: editForm.name.trim(),
				description: editForm.description.trim(),
				subtitle: editForm.subtitle.trim() || null,
				author: editForm.author.trim() || null,
				ownerName: editForm.ownerName.trim() || null,
				ownerEmail: editForm.ownerEmail.trim() || null,
				sortFields: editForm.sortFields,
				sortOrder: editForm.sortOrder,
				feedType: editForm.feedType,
				link: editForm.link.trim() || null,
				copyright: editForm.copyright.trim() || null,
			}

			// Include directoryPaths only for directory feeds
			if (isDirectory) {
				body.directoryPaths = editForm.directoryPaths
			}

			const res = await fetch(`/admin/api/feeds/${feedId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			fetchFeed(feedId)
			router.navigate(getFeedDetailPath(feedId))
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Failed to update feed'
			handle.update()
		} finally {
			editLoading = false
			handle.update()
		}
	}

	const deleteFeed = async () => {
		deleteLoading = true
		handle.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}`, {
				method: 'DELETE',
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Navigate back to the feed list
			window.location.href = '/admin'
		} catch (err) {
			console.error('Failed to delete feed:', err)
			deleteLoading = false
			showDeleteConfirm = false
			handle.update()
		}
	}

	// Artwork management functions
	const uploadArtwork = async (file: File) => {
		artworkUploadLoading = true
		artworkError = null
		handle.update()

		try {
			const formData = new FormData()
			formData.append('file', file)

			const res = await fetch(`/admin/api/feeds/${feedId}/artwork`, {
				method: 'POST',
				body: formData,
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Force image refresh and reload feed data
			artworkImageKey++
			fetchFeed(feedId)
		} catch (err) {
			artworkError =
				err instanceof Error ? err.message : 'Failed to upload artwork'
			handle.update()
		} finally {
			artworkUploadLoading = false
			handle.update()
		}
	}

	const deleteArtwork = async () => {
		artworkDeleteLoading = true
		artworkError = null
		handle.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/artwork`, {
				method: 'DELETE',
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Force image refresh and reload feed data
			artworkImageKey++
			fetchFeed(feedId)
		} catch (err) {
			artworkError =
				err instanceof Error ? err.message : 'Failed to delete artwork'
			handle.update()
		} finally {
			artworkDeleteLoading = false
			handle.update()
		}
	}

	// Item management functions (curated feeds only)
	const removeItem = async (item: MediaItem) => {
		itemActionLoading = true
		handle.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/items`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: [toMediaPath(item)] }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			fetchFeed(feedId)
		} catch (err) {
			console.error('Failed to remove item:', err)
		} finally {
			itemActionLoading = false
			handle.update()
		}
	}

	const moveItem = async (
		items: Array<MediaItem>,
		fromIndex: number,
		toIndex: number,
	) => {
		if (toIndex < 0 || toIndex >= items.length) return

		itemActionLoading = true
		handle.update()

		// Create new order with swapped positions
		const newOrder = items.map((item) => toMediaPath(item))
		const [removed] = newOrder.splice(fromIndex, 1)
		if (removed) newOrder.splice(toIndex, 0, removed)

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/items`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ order: newOrder }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			fetchFeed(feedId)
		} catch (err) {
			console.error('Failed to reorder items:', err)
		} finally {
			itemActionLoading = false
			handle.update()
		}
	}

	const addItems = async (paths: Array<string>) => {
		if (paths.length === 0) return

		itemActionLoading = true
		handle.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: paths }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			showAddFilesModal = false
			fetchFeed(feedId)
		} catch (err) {
			console.error('Failed to add items:', err)
		} finally {
			itemActionLoading = false
			handle.update()
		}
	}

	return (renderProps: { params: Record<string, string> }) => {
		// Fetch on first render or if id changes
		const paramId = renderProps.params.id
		if (paramId && paramId !== feedId) {
			// Use setTimeout to avoid updating during render
			setTimeout(() => fetchFeed(paramId), 0)
		}

		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		if (state.status === 'error') {
			return <ErrorMessage message={state.message} />
		}

		const { feed, tokens, items } = state.data
		const isDirectory = feed.type === 'directory'
		const isCurated = !isDirectory
		const isManualSort = isCurated && feed.sortFields === 'position'
		const activeTokens = tokens.filter((t) => !t.revokedAt)
		const revokedTokens = tokens.filter((t) => t.revokedAt)
		const extraSortColumn = getExtraSortColumn(feed.sortFields)
		const detailHref = getFeedDetailPath(feed.id)
		const editHref = getFeedEditPath(feed.id)
		const isEditRoute = isFeedEditPath(window.location.pathname, feed.id)
		const expectedEditFormSeed = `${feed.id}:${feed.updatedAt}`

		if (!isEditRoute && editFormSeed) {
			editFormSeed = ''
		}
		if (isEditRoute && editFormSeed !== expectedEditFormSeed) {
			editFormSeed = expectedEditFormSeed
			setTimeout(() => {
				syncEditFormWithFeed(feed)
				handle.update()
			}, 0)
			return <LoadingSpinner />
		}

		if (isEditRoute) {
			return (
				<div>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								alignItems: 'center',
								gap: spacing.md,
								marginBottom: spacing.xl,
								flexWrap: 'wrap',
								[mq.mobile]: {
									flexDirection: 'column',
									alignItems: 'stretch',
									gap: spacing.sm,
								},
							}),
						]}
					>
						<div
							mix={[
								rmxCss({
									display: 'flex',
									alignItems: 'center',
									gap: spacing.md,
									flex: 1,
									minWidth: 0,
									[mq.mobile]: {
										flexWrap: 'wrap',
									},
								}),
							]}
						>
							<a
								href={detailHref}
								mix={[
									rmxCss({
										color: colors.textMuted,
										textDecoration: 'none',
										fontSize: typography.fontSize.sm,
										'&:hover': { color: colors.text },
										flexShrink: 0,
									}),
								]}
							>
								← Back to Feed
							</a>
							<h2
								mix={[
									rmxCss({
										fontSize: typography.fontSize.xl,
										fontWeight: typography.fontWeight.semibold,
										color: colors.text,
										margin: 0,
										flex: 1,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										[mq.mobile]: {
											fontSize: typography.fontSize.lg,
											flex: 'none',
											width: '100%',
											order: 2,
										},
									}),
								]}
							>
								{feed.name}
							</h2>
							<span
								mix={[
									rmxCss({
										fontSize: typography.fontSize.xs,
										fontWeight: typography.fontWeight.medium,
										color: isDirectory ? '#3b82f6' : '#8b5cf6',
										backgroundColor: isDirectory
											? 'rgba(59, 130, 246, 0.1)'
											: 'rgba(139, 92, 246, 0.1)',
										padding: `${spacing.xs} ${spacing.sm}`,
										borderRadius: radius.sm,
										textTransform: 'uppercase',
										letterSpacing: '0.05em',
										flexShrink: 0,
									}),
								]}
							>
								{feed.type}
							</span>
						</div>
					</div>

					<div
						mix={[
							rmxCss({
								backgroundColor: colors.surface,
								borderRadius: radius.lg,
								border: `1px solid ${colors.border}`,
								padding: responsive.spacingSection,
								marginBottom: spacing.xl,
								boxShadow: shadows.sm,
							}),
						]}
					>
						<div
							mix={[
								rmxCss({
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									marginBottom: spacing.md,
								}),
							]}
						>
							<h3
								mix={[
									rmxCss({
										fontSize: typography.fontSize.base,
										fontWeight: typography.fontWeight.semibold,
										color: colors.text,
										margin: 0,
									}),
								]}
							>
								Edit Feed Metadata
							</h3>
						</div>

						<EditForm
							form={editForm}
							isDirectory={isDirectory}
							isLoading={editLoading}
							error={editError}
							onNameChange={(value) => {
								editForm.name = value
								handle.update()
							}}
							onDescriptionChange={(value) => {
								editForm.description = value
								handle.update()
							}}
							onSubtitleChange={(value) => {
								editForm.subtitle = value
								handle.update()
							}}
							onMetadataChange={(field, value) => {
								editForm[field] = value
								handle.update()
							}}
							onSortFieldsChange={(value) => {
								editForm.sortFields = value
								handle.update()
							}}
							onSortOrderChange={(value) => {
								editForm.sortOrder = value
								handle.update()
							}}
							onFeedTypeChange={(value) => {
								editForm.feedType = value
								handle.update()
							}}
							onLinkChange={(value) => {
								editForm.link = value
								handle.update()
							}}
							onCopyrightChange={(value) => {
								editForm.copyright = value
								handle.update()
							}}
							onSave={() => saveEdit(isDirectory)}
							onDirectoryPathsChange={
								isDirectory
									? (paths) => {
											editForm.directoryPaths = paths
											handle.update()
										}
									: undefined
							}
							rootsState={rootsState}
							onCancel={cancelEditing}
						/>
					</div>
				</div>
			)
		}

		return (
			<div>
				{/* Delete Confirmation Modal */}
				{showDeleteConfirm && (
					<DeleteConfirmModal
						feedName={feed.name}
						tokenCount={activeTokens.length}
						itemCount={items.length}
						isLoading={deleteLoading}
						onConfirm={deleteFeed}
						onCancel={() => {
							showDeleteConfirm = false
							handle.update()
						}}
					/>
				)}

				{/* Add Files Modal */}
				{showAddFilesModal && (
					<AddFilesModal
						rootsState={rootsState}
						browseState={browseState}
						pickerRoot={pickerRoot}
						pickerPath={pickerPath}
						selectedCount={selectedFilePaths.length}
						isLoading={itemActionLoading}
						onSelectRoot={selectPickerRoot}
						onNavigateToDir={navigatePickerToDir}
						onNavigateUp={navigatePickerUp}
						onToggleFile={(filename) => toggleFileSelection(filename, items)}
						isFileSelected={isFileSelected}
						isFileInFeed={(filename) => isFileInFeed(filename, items)}
						onConfirm={confirmAddFiles}
						onCancel={closeAddFilesModal}
					/>
				)}

				{/* Header */}
				<div
					mix={[
						rmxCss({
							display: 'flex',
							alignItems: 'center',
							gap: spacing.md,
							marginBottom: spacing.xl,
							flexWrap: 'wrap',
							[mq.mobile]: {
								flexDirection: 'column',
								alignItems: 'stretch',
								gap: spacing.sm,
							},
						}),
					]}
				>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								alignItems: 'center',
								gap: spacing.md,
								flex: 1,
								minWidth: 0,
								[mq.mobile]: {
									flexWrap: 'wrap',
								},
							}),
						]}
					>
						<a
							href="/admin"
							mix={[
								rmxCss({
									color: colors.textMuted,
									textDecoration: 'none',
									fontSize: typography.fontSize.sm,
									'&:hover': { color: colors.text },
									flexShrink: 0,
								}),
							]}
						>
							← Back
						</a>
						<h2
							mix={[
								rmxCss({
									fontSize: typography.fontSize.xl,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
									flex: 1,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									[mq.mobile]: {
										fontSize: typography.fontSize.lg,
										flex: 'none',
										width: '100%',
										order: 2,
									},
								}),
							]}
						>
							{feed.name}
						</h2>
						<span
							mix={[
								rmxCss({
									fontSize: typography.fontSize.xs,
									fontWeight: typography.fontWeight.medium,
									color: isDirectory ? '#3b82f6' : '#8b5cf6',
									backgroundColor: isDirectory
										? 'rgba(59, 130, 246, 0.1)'
										: 'rgba(139, 92, 246, 0.1)',
									padding: `${spacing.xs} ${spacing.sm}`,
									borderRadius: radius.sm,
									textTransform: 'uppercase',
									letterSpacing: '0.05em',
									flexShrink: 0,
								}),
							]}
						>
							{feed.type}
						</span>
					</div>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								gap: spacing.sm,
								[mq.mobile]: {
									width: '100%',
								},
							}),
						]}
					>
						<a
							href={editHref}
							mix={[
								rmxCss({
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									padding: `${spacing.xs} ${spacing.md}`,
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
									color: colors.primary,
									backgroundColor: 'transparent',
									border: `1px solid ${colors.primary}`,
									borderRadius: radius.md,
									textDecoration: 'none',
									transition: `all ${transitions.fast}`,
									'&:hover': {
										backgroundColor: colors.primarySoft,
									},
									[mq.mobile]: {
										flex: 1,
									},
								}),
							]}
						>
							Edit Feed
						</a>
						<button
							type="button"
							mix={[
								rmxCss({
									padding: `${spacing.xs} ${spacing.md}`,
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
									color: '#ef4444',
									backgroundColor: 'transparent',
									border: '1px solid #ef4444',
									borderRadius: radius.md,
									cursor: 'pointer',
									transition: `all ${transitions.fast}`,
									'&:hover': {
										backgroundColor: 'rgba(239, 68, 68, 0.1)',
									},
									[mq.mobile]: {
										flex: 1,
									},
								}),
								rmxOn('click', () => {
									showDeleteConfirm = true
									handle.update()
								}),
							]}
						>
							Delete
						</button>
					</div>
				</div>

				{/* Feed Info Card */}
				<div
					mix={[
						rmxCss({
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							marginBottom: spacing.xl,
							boxShadow: shadows.sm,
						}),
					]}
				>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								marginBottom: spacing.md,
							}),
						]}
					>
						<h3
							mix={[
								rmxCss({
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
								}),
							]}
						>
							Feed Details
						</h3>
					</div>

					{feed.description && (
						<p
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									margin: `0 0 ${spacing.md} 0`,
								}),
							]}
						>
							{feed.description}
						</p>
					)}

					<div
						mix={[
							rmxCss({
								display: 'grid',
								gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
								gap: spacing.md,
							}),
						]}
					>
						{isDirectory && (
							<DirectoriesInfo
								directoryPaths={(feed as DirectoryFeed).directoryPaths}
							/>
						)}
						<InfoItem
							label="Feed Type"
							value={feed.feedType === 'serial' ? 'Serial' : 'Episodic'}
						/>
						<InfoItem label="Subtitle" value={feed.subtitle ?? '—'} />
						<InfoItem label="Author" value={feed.author ?? '—'} />
						<InfoItem label="Owner Name" value={feed.ownerName ?? '—'} />
						<InfoItem label="Owner Email" value={feed.ownerEmail ?? '—'} />
						<InfoItem
							label="Website"
							value={feed.link ?? '—'}
							mono={Boolean(feed.link)}
							href={feed.link ?? undefined}
						/>
						<InfoItem label="Copyright" value={feed.copyright ?? '—'} />
						<InfoItem
							label="Sort"
							value={
								feed.sortFields === 'position'
									? 'position (manual)'
									: `${feed.sortFields} (${feed.sortOrder})`
							}
						/>
						<InfoItem
							label="Created"
							value={formatDate(feed.createdAt, { style: 'short' })}
						/>
						<InfoItem
							label="Updated"
							value={formatDate(feed.updatedAt, { style: 'short' })}
						/>
					</div>
				</div>

				{/* Feed Artwork Section */}
				<div
					mix={[
						rmxCss({
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							marginBottom: spacing.xl,
							boxShadow: shadows.sm,
						}),
					]}
				>
					<h3
						mix={[
							rmxCss({
								fontSize: typography.fontSize.base,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: `0 0 ${spacing.md} 0`,
							}),
						]}
					>
						Feed Artwork
					</h3>

					<div
						mix={[
							rmxCss({
								display: 'flex',
								gap: spacing.lg,
								flexWrap: 'wrap',
								alignItems: 'flex-start',
							}),
						]}
					>
						{/* Artwork Preview */}
						<div mix={[rmxCss({ flexShrink: 0 })]}>
							<img
								key={artworkImageKey}
								src={`/admin/api/feeds/${feed.id}/artwork?t=${artworkImageKey}`}
								alt="Feed artwork"
								mix={[
									rmxCss({
										width: '120px',
										height: '120px',
										borderRadius: radius.md,
										...artworkLayout.centeredContain,
										backgroundColor: colors.background,
										border: `1px solid ${colors.border}`,
									}),
									rmxOn<HTMLImageElement, 'error'>('error', (e: Event) => {
										// Fallback to placeholder if no artwork
										const img = e.target as HTMLImageElement
										img.src = `data:image/svg+xml,${encodeURIComponent(
											`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#1a1a2e"/><text x="60" y="72" font-family="system-ui" font-size="48" font-weight="bold" fill="#e94560" text-anchor="middle">${feed.name.trim()[0]?.toUpperCase() ?? '?'}</text></svg>`,
										)}`
									}),
								]}
							/>
						</div>

						{/* Artwork Controls */}
						<div mix={[rmxCss({ flex: 1, minWidth: '280px' })]}>
							{/* Current Source Indicator */}
							<div
								mix={[
									rmxCss({
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										marginBottom: spacing.md,
									}),
								]}
							>
								<strong>Current source:</strong>{' '}
								{state.status === 'success' && state.data.hasUploadedArtwork
									? 'Uploaded artwork'
									: 'Generated placeholder'}
							</div>

							{/* Upload Button */}
							<div mix={[rmxCss({ marginBottom: spacing.md })]}>
								<input
									type="file"
									id="artwork-upload"
									accept="image/jpeg,image/png,image/webp"
									mix={[
										rmxCss({ display: 'none' }),
										rmxOn('change', (e) => {
											const input = e.target as HTMLInputElement
											const file = input.files?.[0]
											if (file) {
												uploadArtwork(file)
												input.value = '' // Reset for re-upload
											}
										}),
									]}
								/>
								<div
									mix={[
										rmxCss({
											display: 'flex',
											gap: spacing.sm,
											flexWrap: 'wrap',
										}),
									]}
								>
									<label
										for="artwork-upload"
										mix={[
											rmxCss({
												display: 'inline-block',
												padding: `${spacing.xs} ${spacing.md}`,
												fontSize: typography.fontSize.sm,
												fontWeight: typography.fontWeight.medium,
												color: colors.background,
												backgroundColor: artworkUploadLoading
													? colors.border
													: colors.primary,
												borderRadius: radius.md,
												cursor: artworkUploadLoading
													? 'not-allowed'
													: 'pointer',
												transition: `all ${transitions.fast}`,
												'&:hover': artworkUploadLoading
													? {}
													: { backgroundColor: colors.primaryHover },
											}),
										]}
									>
										{artworkUploadLoading ? 'Uploading...' : 'Upload Artwork'}
									</label>
									{state.status === 'success' &&
										state.data.hasUploadedArtwork && (
											<button
												type="button"
												disabled={artworkDeleteLoading}
												mix={[
													rmxCss({
														padding: `${spacing.xs} ${spacing.md}`,
														fontSize: typography.fontSize.sm,
														fontWeight: typography.fontWeight.medium,
														color: '#ef4444',
														backgroundColor: 'transparent',
														border: '1px solid #ef4444',
														borderRadius: radius.md,
														cursor: artworkDeleteLoading
															? 'not-allowed'
															: 'pointer',
														transition: `all ${transitions.fast}`,
														'&:hover': artworkDeleteLoading
															? {}
															: { backgroundColor: 'rgba(239, 68, 68, 0.1)' },
													}),
													rmxOn('click', deleteArtwork),
												]}
											>
												{artworkDeleteLoading
													? 'Removing...'
													: 'Remove Uploaded'}
											</button>
										)}
								</div>
								<p
									mix={[
										rmxCss({
											fontSize: typography.fontSize.xs,
											color: colors.textMuted,
											margin: `${spacing.xs} 0 0 0`,
										}),
									]}
								>
									JPEG, PNG, or WebP. Max 5MB.
								</p>
							</div>

							{/* Error Message */}
							{artworkError && (
								<div
									mix={[
										rmxCss({
											padding: spacing.sm,
											backgroundColor: 'rgba(239, 68, 68, 0.1)',
											borderRadius: radius.md,
											border: '1px solid rgba(239, 68, 68, 0.3)',
											marginBottom: spacing.sm,
										}),
									]}
								>
									<p
										mix={[
											rmxCss({
												color: '#ef4444',
												margin: 0,
												fontSize: typography.fontSize.sm,
											}),
										]}
									>
										{artworkError}
									</p>
								</div>
							)}

							{/* Priority Note */}
							<p
								mix={[
									rmxCss({
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										margin: 0,
										fontStyle: 'italic',
									}),
								]}
							>
								Without an uploaded image, MediaRSS serves a generated square
								placeholder.
							</p>
						</div>
					</div>
				</div>

				{/* Media Items Section */}
				<div
					mix={[
						rmxCss({
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							marginBottom: spacing.xl,
							boxShadow: shadows.sm,
						}),
					]}
				>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								marginBottom: spacing.lg,
							}),
						]}
					>
						<h3
							mix={[
								rmxCss({
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
								}),
							]}
						>
							Media Items ({items.length})
						</h3>
						{!isDirectory && (
							<button
								type="button"
								mix={[
									rmxCss({
										padding: `${spacing.xs} ${spacing.md}`,
										fontSize: typography.fontSize.sm,
										fontWeight: typography.fontWeight.medium,
										color: colors.background,
										backgroundColor: colors.primary,
										border: 'none',
										borderRadius: radius.md,
										cursor: 'pointer',
										transition: `all ${transitions.fast}`,
										'&:hover': { backgroundColor: colors.primaryHover },
									}),
									rmxOn('click', openAddFilesModal),
								]}
							>
								+ Add Files
							</button>
						)}
					</div>

					{items.length === 0 ? (
						<div
							mix={[
								rmxCss({
									textAlign: 'center',
									padding: spacing.xl,
									color: colors.textMuted,
								}),
							]}
						>
							<p mix={[rmxCss({ margin: 0 })]}>
								No media items found in this feed.
							</p>
						</div>
					) : (
						<div
							mix={[
								rmxCss({
									overflowX: 'auto',
									overflowY: 'auto',
									maxHeight: '400px',
								}),
							]}
						>
							<table
								mix={[
									rmxCss({
										width: '100%',
										borderCollapse: 'collapse',
										fontSize: typography.fontSize.sm,
									}),
								]}
							>
								<thead
									mix={[
										rmxCss({
											position: 'sticky',
											top: 0,
											backgroundColor: colors.surface,
											zIndex: 1,
										}),
									]}
								>
									<tr
										mix={[
											rmxCss({
												borderBottom: `1px solid ${colors.border}`,
											}),
										]}
									>
										{isManualSort && (
											<th
												mix={[
													rmxCss({
														width: '32px',
														padding: `${spacing.sm} ${spacing.xs}`,
													}),
												]}
											/>
										)}
										<th
											mix={[
												rmxCss({
													textAlign: 'left',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													width: '40px',
												}),
											]}
										>
											#
										</th>
										<th
											mix={[
												rmxCss({
													width: '48px',
													padding: `${spacing.sm}`,
												}),
											]}
										/>
										<th
											mix={[
												rmxCss({
													textAlign: 'left',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
												}),
											]}
										>
											Title
										</th>
										<th
											mix={[
												rmxCss({
													textAlign: 'left',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													[mq.mobile]: {
														display: 'none',
													},
												}),
											]}
										>
											Author
										</th>
										<th
											mix={[
												rmxCss({
													textAlign: 'right',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													width: '80px',
													[mq.mobile]: {
														display: 'none',
													},
												}),
											]}
										>
											Duration
										</th>
										<th
											mix={[
												rmxCss({
													textAlign: 'right',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													width: '80px',
													[mq.mobile]: {
														display: 'none',
													},
												}),
											]}
										>
											Size
										</th>
										{extraSortColumn && (
											<th
												title={`Sorted by ${getSortFieldLabel(extraSortColumn)}`}
												mix={[
													rmxCss({
														textAlign: 'left',
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.primary,
														fontWeight: typography.fontWeight.medium,
														fontSize: typography.fontSize.xs,
														textTransform: 'uppercase',
														letterSpacing: '0.05em',
														backgroundColor: colors.primarySoft,
														whiteSpace: 'nowrap',
													}),
												]}
											>
												{getSortFieldLabel(extraSortColumn)} ↓
											</th>
										)}
										{isCurated && (
											<th
												mix={[
													rmxCss({
														textAlign: 'center',
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.textMuted,
														fontWeight: typography.fontWeight.medium,
														fontSize: typography.fontSize.xs,
														textTransform: 'uppercase',
														letterSpacing: '0.05em',
														width: isManualSort ? '120px' : '60px',
													}),
												]}
											>
												Actions
											</th>
										)}
										<th
											mix={[
												rmxCss({
													textAlign: 'center',
													padding: `${spacing.sm} ${spacing.md}`,
													width: '60px',
												}),
											]}
										/>
									</tr>
								</thead>
								<tbody>
									{items.map((item, index) => (
										<tr
											key={toMediaPath(item)}
											draggable={isManualSort}
											mix={[
												rmxCss({
													borderBottom: `1px solid ${colors.border}`,
													'&:last-child': { borderBottom: 'none' },
													'&:hover': {
														backgroundColor: colors.background,
													},
													opacity: draggingIndex === index ? 0.5 : 1,
													backgroundColor:
														dragOverIndex === index
															? colors.primarySoft
															: 'transparent',
													cursor: isManualSort ? 'grab' : 'default',
												}),
											]}
										>
											{isManualSort && (
												<td
													mix={[
														rmxCss({
															padding: `${spacing.sm} ${spacing.xs}`,
															color: colors.textMuted,
															cursor: 'grab',
															textAlign: 'center',
															userSelect: 'none',
														}),
													]}
												>
													<span
														mix={[rmxCss({ fontSize: typography.fontSize.sm })]}
													>
														⋮⋮
													</span>
												</td>
											)}
											<td
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.textMuted,
														fontFamily: 'monospace',
														fontSize: typography.fontSize.xs,
													}),
												]}
											>
												{index + 1}
											</td>
											<td
												mix={[
													rmxCss({ padding: spacing.sm, textAlign: 'center' }),
												]}
											>
												<img
													src={`/admin/api/artwork/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
													alt=""
													loading="lazy"
													mix={[
														rmxCss({
															width: '32px',
															height: '32px',
															borderRadius: radius.sm,
															...artworkLayout.centeredContain,
															backgroundColor: colors.background,
														}),
													]}
												/>
											</td>
											<td
												title={item.title}
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.text,
														maxWidth: '300px',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
													}),
												]}
											>
												{item.title}
											</td>
											<td
												title={item.author ?? undefined}
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.textMuted,
														maxWidth: '200px',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
														[mq.mobile]: {
															display: 'none',
														},
													}),
												]}
											>
												{item.author || '—'}
											</td>
											<td
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.textMuted,
														textAlign: 'right',
														fontFamily: 'monospace',
														fontSize: typography.fontSize.xs,
														[mq.mobile]: {
															display: 'none',
														},
													}),
												]}
											>
												{formatDuration(item.duration)}
											</td>
											<td
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.textMuted,
														textAlign: 'right',
														fontFamily: 'monospace',
														fontSize: typography.fontSize.xs,
														[mq.mobile]: {
															display: 'none',
														},
													}),
												]}
											>
												{formatFileSize(item.sizeBytes)}
											</td>
											{extraSortColumn && (
												<td
													title={formatSortValue(item, extraSortColumn)}
													mix={[
														rmxCss({
															padding: `${spacing.sm} ${spacing.md}`,
															color: colors.text,
															fontSize: typography.fontSize.xs,
															backgroundColor: colors.primarySoftest,
															whiteSpace: 'nowrap',
														}),
													]}
												>
													{formatSortValue(item, extraSortColumn)}
												</td>
											)}
											{isCurated && (
												<td
													mix={[
														rmxCss({
															padding: `${spacing.sm} ${spacing.md}`,
															textAlign: 'center',
														}),
													]}
												>
													<div
														mix={[
															rmxCss({
																display: 'flex',
																gap: spacing.xs,
																justifyContent: 'center',
																alignItems: 'center',
															}),
														]}
													>
														{isManualSort && (
															<>
																<button
																	type="button"
																	disabled={index === 0 || itemActionLoading}
																	title="Move up"
																	mix={[
																		rmxCss({
																			padding: spacing.xs,
																			fontSize: typography.fontSize.sm,
																			color:
																				index === 0
																					? colors.border
																					: colors.textMuted,
																			backgroundColor: 'transparent',
																			border: `1px solid ${index === 0 ? colors.border : colors.border}`,
																			borderRadius: radius.sm,
																			cursor:
																				index === 0 ? 'not-allowed' : 'pointer',
																			transition: `all ${transitions.fast}`,
																			lineHeight: 1,
																			'&:hover':
																				index === 0
																					? {}
																					: {
																							color: colors.text,
																							borderColor: colors.text,
																						},
																		}),
																		rmxOn('click', () =>
																			moveItem(items, index, index - 1),
																		),
																	]}
																>
																	↑
																</button>
																<button
																	type="button"
																	disabled={
																		index === items.length - 1 ||
																		itemActionLoading
																	}
																	title="Move down"
																	mix={[
																		rmxCss({
																			padding: spacing.xs,
																			fontSize: typography.fontSize.sm,
																			color:
																				index === items.length - 1
																					? colors.border
																					: colors.textMuted,
																			backgroundColor: 'transparent',
																			border: `1px solid ${index === items.length - 1 ? colors.border : colors.border}`,
																			borderRadius: radius.sm,
																			cursor:
																				index === items.length - 1
																					? 'not-allowed'
																					: 'pointer',
																			transition: `all ${transitions.fast}`,
																			lineHeight: 1,
																			'&:hover':
																				index === items.length - 1
																					? {}
																					: {
																							color: colors.text,
																							borderColor: colors.text,
																						},
																		}),
																		rmxOn('click', () =>
																			moveItem(items, index, index + 1),
																		),
																	]}
																>
																	↓
																</button>
															</>
														)}
														<button
															type="button"
															disabled={itemActionLoading}
															title="Remove"
															mix={[
																rmxCss({
																	padding: spacing.xs,
																	fontSize: typography.fontSize.sm,
																	color: '#ef4444',
																	backgroundColor: 'transparent',
																	border: '1px solid #ef4444',
																	borderRadius: radius.sm,
																	cursor: itemActionLoading
																		? 'not-allowed'
																		: 'pointer',
																	transition: `all ${transitions.fast}`,
																	lineHeight: 1,
																	'&:hover': itemActionLoading
																		? {}
																		: {
																				backgroundColor:
																					'rgba(239, 68, 68, 0.1)',
																			},
																}),
																rmxOn('click', () => removeItem(item)),
															]}
														>
															×
														</button>
													</div>
												</td>
											)}
											<td
												mix={[
													rmxCss({
														padding: `${spacing.sm} ${spacing.md}`,
														textAlign: 'center',
													}),
												]}
											>
												<a
													href={`/admin/media/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
													mix={[
														rmxCss({
															display: 'inline-block',
															padding: `${spacing.xs} ${spacing.sm}`,
															fontSize: typography.fontSize.xs,
															fontWeight: typography.fontWeight.medium,
															color: colors.primary,
															backgroundColor: colors.primarySoft,
															borderRadius: radius.sm,
															textDecoration: 'none',
															'&:hover': {
																backgroundColor: colors.primarySoftHover,
															},
														}),
													]}
												>
													View
												</a>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Analytics Section */}
				<div
					mix={[
						rmxCss({
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							marginBottom: spacing.xl,
							boxShadow: shadows.sm,
						}),
					]}
				>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: spacing.sm,
								marginBottom: spacing.md,
								flexWrap: 'wrap',
							}),
						]}
					>
						<h3
							mix={[
								rmxCss({
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
								}),
							]}
						>
							Analytics (last {analyticsWindowDays} days)
						</h3>
						<div mix={[rmxCss({ display: 'flex', gap: spacing.xs })]}>
							{[7, 30, 90].map((days) => (
								<button
									key={days}
									type="button"
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.sm}`,
											fontSize: typography.fontSize.xs,
											fontWeight: typography.fontWeight.medium,
											color:
												days === analyticsWindowDays
													? colors.background
													: colors.textMuted,
											backgroundColor:
												days === analyticsWindowDays
													? colors.primary
													: 'transparent',
											border: `1px solid ${days === analyticsWindowDays ? colors.primary : colors.border}`,
											borderRadius: radius.sm,
											cursor: 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': {
												borderColor: colors.primary,
												color:
													days === analyticsWindowDays
														? colors.background
														: colors.text,
											},
										}),
										rmxOn('click', () => {
											if (days === analyticsWindowDays) return
											analyticsWindowDays = days
											if (feedId) {
												fetchAnalytics(feedId, days)
											} else {
												handle.update()
											}
										}),
									]}
								>
									{days}d
								</button>
							))}
						</div>
					</div>

					<FeedAnalyticsSection analyticsState={analyticsState} />
				</div>

				{/* Tokens Section */}
				<div
					mix={[
						rmxCss({
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							boxShadow: shadows.sm,
						}),
					]}
				>
					<div
						mix={[
							rmxCss({
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								marginBottom: spacing.lg,
							}),
						]}
					>
						<h3
							mix={[
								rmxCss({
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
								}),
							]}
						>
							Access Tokens ({activeTokens.length})
						</h3>
						{!showCreateForm && (
							<button
								type="button"
								mix={[
									rmxCss({
										padding: `${spacing.xs} ${spacing.md}`,
										fontSize: typography.fontSize.sm,
										fontWeight: typography.fontWeight.medium,
										color: colors.background,
										backgroundColor: colors.primary,
										border: 'none',
										borderRadius: radius.md,
										cursor: 'pointer',
										transition: `all ${transitions.fast}`,
										'&:hover': { backgroundColor: colors.primaryHover },
									}),
									rmxOn('click', () => {
										showCreateForm = true
										handle.update()
									}),
								]}
							>
								+ New Token
							</button>
						)}
					</div>

					{/* Create Token Form */}
					{showCreateForm && (
						<div
							mix={[
								rmxCss({
									backgroundColor: colors.background,
									borderRadius: radius.md,
									padding: spacing.md,
									marginBottom: spacing.lg,
									border: `1px solid ${colors.border}`,
								}),
							]}
						>
							<div mix={[rmxCss({ marginBottom: spacing.sm })]}>
								<label
									for="new-token-label"
									mix={[
										rmxCss({
											display: 'block',
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											color: colors.text,
											marginBottom: spacing.xs,
										}),
									]}
								>
									Label (optional)
								</label>
								<input
									id="new-token-label"
									type="text"
									value={newTokenLabel}
									placeholder="e.g., iPhone, Podcast App"
									mix={[
										rmxCss({
											width: '100%',
											padding: spacing.sm,
											fontSize: typography.fontSize.sm,
											color: colors.text,
											backgroundColor: colors.surface,
											border: `1px solid ${colors.border}`,
											borderRadius: radius.md,
											outline: 'none',
											'&:focus': { borderColor: colors.primary },
										}),
										rmxOn('input', (e) => {
											newTokenLabel = (e.target as HTMLInputElement).value
											handle.update()
										}),
									]}
								/>
							</div>
							<div mix={[rmxCss({ display: 'flex', gap: spacing.sm })]}>
								<button
									type="button"
									disabled={createLoading}
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											color: colors.background,
											backgroundColor: createLoading
												? colors.border
												: colors.primary,
											border: 'none',
											borderRadius: radius.md,
											cursor: createLoading ? 'not-allowed' : 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': createLoading
												? {}
												: { backgroundColor: colors.primaryHover },
										}),
										rmxOn('click', createToken),
									]}
								>
									{createLoading ? 'Creating...' : 'Create'}
								</button>
								<button
									type="button"
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											color: colors.text,
											backgroundColor: 'transparent',
											border: `1px solid ${colors.border}`,
											borderRadius: radius.md,
											cursor: 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': { backgroundColor: colors.surface },
										}),
										rmxOn('click', () => {
											showCreateForm = false
											newTokenLabel = ''
											handle.update()
										}),
									]}
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					{/* Active Tokens */}
					{activeTokens.length === 0 ? (
						<div
							mix={[
								rmxCss({
									textAlign: 'center',
									padding: spacing.xl,
									color: colors.textMuted,
								}),
							]}
						>
							<p mix={[rmxCss({ margin: 0 })]}>
								No tokens yet. Create one to share this feed.
							</p>
						</div>
					) : (
						<div
							mix={[
								rmxCss({
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}),
							]}
						>
							{activeTokens.map((token) => (
								<TokenCard
									key={token.token}
									token={token}
									isCopied={copiedToken === token.token}
									onCopy={() => copyFeedUrl(token.token)}
									onRevoke={() => revokeToken(token.token)}
								/>
							))}
						</div>
					)}

					{/* Revoked Tokens (collapsed) */}
					{revokedTokens.length > 0 && (
						<div mix={[rmxCss({ marginTop: spacing.lg })]}>
							<p
								mix={[
									rmxCss({
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										margin: `0 0 ${spacing.sm} 0`,
									}),
								]}
							>
								{revokedTokens.length} revoked token
								{revokedTokens.length !== 1 ? 's' : ''}
							</p>
						</div>
					)}
				</div>
			</div>
		)
	}
}

function LoadingSpinner() {
	return () => (
		<div
			mix={[
				rmxCss({
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					padding: spacing['2xl'],
				}),
			]}
		>
			<div
				mix={[
					rmxCss({
						width: '40px',
						height: '40px',
						border: `3px solid ${colors.border}`,
						borderTopColor: colors.primary,
						borderRadius: '50%',
						animation: 'spin 1s linear infinite',
						'@keyframes spin': {
							to: { transform: 'rotate(360deg)' },
						},
					}),
				]}
			/>
		</div>
	)
}

function ErrorMessage() {
	return ({ message }: { message: string }) => (
		<div
			mix={[
				rmxCss({
					padding: spacing.xl,
					backgroundColor: 'rgba(239, 68, 68, 0.1)',
					borderRadius: radius.md,
					border: '1px solid rgba(239, 68, 68, 0.3)',
				}),
			]}
		>
			<p
				mix={[
					rmxCss({
						color: '#ef4444',
						margin: 0,
						fontSize: typography.fontSize.base,
					}),
				]}
			>
				Failed to load feed: {message}
			</p>
			<a
				href="/admin"
				mix={[
					rmxCss({
						display: 'inline-block',
						marginTop: spacing.md,
						color: colors.primary,
						textDecoration: 'none',
						'&:hover': { textDecoration: 'underline' },
					}),
				]}
			>
				← Back to feeds
			</a>
		</div>
	)
}

function InfoItem() {
	return ({
		label,
		value,
		mono,
		href,
	}: {
		label: string
		value: string
		mono?: boolean
		href?: string
	}) => (
		<div>
			<dt
				mix={[
					rmxCss({
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						marginBottom: spacing.xs,
					}),
				]}
			>
				{label}
			</dt>
			<dd
				mix={[
					rmxCss({
						fontSize: typography.fontSize.sm,
						color: colors.text,
						margin: 0,
						fontFamily: mono ? 'monospace' : 'inherit',
						wordBreak: mono ? 'break-all' : 'normal',
					}),
				]}
			>
				{href ? (
					<a
						href={href}
						target="_blank"
						rel="noreferrer"
						mix={[
							rmxCss({
								color: colors.primary,
								textDecoration: 'none',
								fontFamily: mono ? 'monospace' : 'inherit',
								wordBreak: mono ? 'break-all' : 'normal',
								'&:hover': { textDecoration: 'underline' },
							}),
						]}
					>
						{value}
					</a>
				) : (
					value
				)}
			</dd>
		</div>
	)
}

function DirectoriesInfo() {
	return ({ directoryPaths }: { directoryPaths: string }) => {
		let paths: Array<string> = []
		try {
			paths = JSON.parse(directoryPaths) as Array<string>
		} catch {
			paths = []
		}

		return (
			<div
				mix={[rmxCss({ gridColumn: paths.length > 1 ? '1 / -1' : undefined })]}
			>
				<dt
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
							marginBottom: spacing.xs,
						}),
					]}
				>
					{paths.length === 1 ? 'Directory' : `Directories (${paths.length})`}
				</dt>
				<dd mix={[rmxCss({ margin: 0 })]}>
					{paths.length === 0 ? (
						<span
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
								}),
							]}
						>
							No directories configured
						</span>
					) : paths.length === 1 ? (
						<span
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.text,
									fontFamily: 'monospace',
									wordBreak: 'break-all',
								}),
							]}
						>
							{paths[0]}
						</span>
					) : (
						<ul
							mix={[
								rmxCss({
									listStyle: 'none',
									padding: 0,
									margin: 0,
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.xs,
								}),
							]}
						>
							{paths.map((path, _index) => (
								<li
									key={path}
									mix={[
										rmxCss({
											fontSize: typography.fontSize.sm,
											color: colors.text,
											fontFamily: 'monospace',
											wordBreak: 'break-all',
											padding: `${spacing.xs} ${spacing.sm}`,
											backgroundColor: colors.background,
											borderRadius: radius.sm,
											border: `1px solid ${colors.border}`,
										}),
									]}
								>
									{path}
								</li>
							))}
						</ul>
					)}
				</dd>
			</div>
		)
	}
}

function TokenCard() {
	return ({
		token,
		isCopied,
		onCopy,
		onRevoke,
	}: {
		token: Token
		isCopied: boolean
		onCopy: () => void
		onRevoke: () => void
	}) => (
		<div
			mix={[
				rmxCss({
					display: 'flex',
					alignItems: 'center',
					gap: spacing.md,
					padding: spacing.md,
					backgroundColor: colors.background,
					borderRadius: radius.md,
					border: `1px solid ${colors.border}`,
				}),
			]}
		>
			<div mix={[rmxCss({ flex: 1, minWidth: 0 })]}>
				<div
					mix={[
						rmxCss({
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					{token.label || 'Unlabeled token'}
				</div>
				<div
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							display: 'flex',
							gap: spacing.md,
							flexWrap: 'wrap',
						}),
					]}
				>
					<span>Created {formatDate(token.createdAt, { style: 'short' })}</span>
					<span>Last used: {formatRelativeTime(token.lastUsedAt)}</span>
				</div>
			</div>
			<div mix={[rmxCss({ display: 'flex', gap: spacing.sm })]}>
				<button
					type="button"
					mix={[
						rmxCss({
							padding: `${spacing.xs} ${spacing.sm}`,
							fontSize: typography.fontSize.xs,
							fontWeight: typography.fontWeight.medium,
							color: isCopied ? '#10b981' : colors.primary,
							backgroundColor: 'transparent',
							border: `1px solid ${isCopied ? '#10b981' : colors.primary}`,
							borderRadius: radius.sm,
							cursor: 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: isCopied
									? 'rgba(16, 185, 129, 0.1)'
									: colors.primarySoft,
							},
						}),
						rmxOn('click', onCopy),
					]}
				>
					{isCopied ? '✓ Copied' : 'Copy URL'}
				</button>
				<button
					type="button"
					mix={[
						rmxCss({
							padding: `${spacing.xs} ${spacing.sm}`,
							fontSize: typography.fontSize.xs,
							fontWeight: typography.fontWeight.medium,
							color: '#ef4444',
							backgroundColor: 'transparent',
							border: '1px solid #ef4444',
							borderRadius: radius.sm,
							cursor: 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: 'rgba(239, 68, 68, 0.1)',
							},
						}),
						rmxOn('click', onRevoke),
					]}
				>
					Revoke
				</button>
			</div>
		</div>
	)
}

const inputStyles = {
	width: '100%',
	padding: spacing.sm,
	fontSize: typography.fontSize.sm,
	color: colors.text,
	backgroundColor: colors.background,
	border: `1px solid ${colors.border}`,
	borderRadius: radius.md,
	outline: 'none',
	transition: `border-color ${transitions.fast}`,
	'&:focus': {
		borderColor: colors.primary,
	},
	'&::placeholder': {
		color: colors.textMuted,
	},
}

type MetadataField = 'author' | 'ownerName' | 'ownerEmail'

function EditForm() {
	return ({
		form,
		isDirectory,
		isLoading,
		error,
		onNameChange,
		onDescriptionChange,
		onSubtitleChange,
		onMetadataChange,
		onSortFieldsChange,
		onSortOrderChange,
		onFeedTypeChange,
		onLinkChange,
		onCopyrightChange,
		onDirectoryPathsChange,
		rootsState,
		onSave,
		onCancel,
	}: {
		form: EditFormState
		isDirectory: boolean
		isLoading: boolean
		error: string | null
		onNameChange: (value: string) => void
		onDescriptionChange: (value: string) => void
		onSubtitleChange: (value: string) => void
		onMetadataChange: (field: MetadataField, value: string) => void
		onSortFieldsChange: (value: string) => void
		onSortOrderChange: (value: 'asc' | 'desc') => void
		onFeedTypeChange: (value: 'episodic' | 'serial') => void
		onLinkChange: (value: string) => void
		onCopyrightChange: (value: string) => void
		onDirectoryPathsChange?: (paths: Array<string>) => void
		rootsState: RootsState
		onSave: () => void
		onCancel: () => void
	}) => (
		<div>
			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-name"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Name <span mix={[rmxCss({ color: '#ef4444' })]}>*</span>
				</label>
				<input
					id="edit-feed-name"
					type="text"
					value={form.name}
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onNameChange((e.target as HTMLInputElement).value),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-description"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Description
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					Falls back to subtitle if not provided.
				</p>
				<textarea
					id="edit-feed-description"
					value={form.description}
					rows={3}
					mix={[
						rmxCss({ ...inputStyles, resize: 'vertical', minHeight: '80px' }),
						rmxOn('input', (e) =>
							onDescriptionChange((e.target as HTMLTextAreaElement).value),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-subtitle"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Subtitle
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					A short tagline shown in podcast apps (max 255 characters). Falls back
					to a truncated description if not provided.
				</p>
				<input
					id="edit-feed-subtitle"
					type="text"
					value={form.subtitle}
					placeholder="Optional short tagline"
					maxLength={255}
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onSubtitleChange((e.target as HTMLInputElement).value),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-author"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Author
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					Shown under the podcast title in most apps. Falls back to owner name
					if not provided.
				</p>
				<input
					id="edit-feed-author"
					type="text"
					value={form.author}
					placeholder="Author or publisher name"
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onMetadataChange('author', (e.target as HTMLInputElement).value),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-owner-name"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Owner Name
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					iTunes owner metadata for contact name.
				</p>
				<input
					id="edit-feed-owner-name"
					type="text"
					value={form.ownerName}
					placeholder="Owner or publisher name"
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onMetadataChange(
								'ownerName',
								(e.target as HTMLInputElement).value,
							),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-owner-email"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Owner Email
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					iTunes owner contact email (not shown in podcast apps).
				</p>
				<input
					id="edit-feed-owner-email"
					type="email"
					value={form.ownerEmail}
					placeholder="owner@example.com"
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onMetadataChange(
								'ownerEmail',
								(e.target as HTMLInputElement).value,
							),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-type"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Feed Type
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					Episodic: Episodes can be listened to in any order (default for most
					podcasts). Serial: Episodes should be listened to in sequence (like
					audiobooks or story-driven series).
				</p>
				<select
					id="edit-feed-type"
					value={form.feedType}
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onFeedTypeChange(
								(e.target as HTMLSelectElement).value as 'episodic' | 'serial',
							),
						),
					]}
				>
					<option value="episodic">Episodic</option>
					<option value="serial">Serial</option>
				</select>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-link"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Website Link
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					A link to the podcast's website. Defaults to the feed page if not
					provided.
				</p>
				<input
					id="edit-feed-link"
					type="url"
					value={form.link}
					placeholder="https://example.com"
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onLinkChange((e.target as HTMLInputElement).value),
						),
					]}
				/>
			</div>

			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<label
					for="edit-feed-copyright"
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Copyright
				</label>
				<p
					mix={[
						rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							margin: `0 0 ${spacing.sm} 0`,
							lineHeight: 1.5,
						}),
					]}
				>
					Copyright notice for the feed content.
				</p>
				<input
					id="edit-feed-copyright"
					type="text"
					value={form.copyright}
					placeholder="© 2024 Your Name"
					mix={[
						rmxCss(inputStyles),
						rmxOn('input', (e) =>
							onCopyrightChange((e.target as HTMLInputElement).value),
						),
					]}
				/>
			</div>

			{isDirectory && onDirectoryPathsChange && (
				<DirectoryPathsEditor
					paths={form.directoryPaths}
					rootsState={rootsState}
					onPathsChange={onDirectoryPathsChange}
				/>
			)}

			<div
				mix={[
					rmxCss({
						display: 'grid',
						gridTemplateColumns: '1fr 1fr',
						gap: spacing.md,
						marginBottom: spacing.md,
					}),
				]}
			>
				<div>
					<label
						for="edit-feed-sort-fields"
						mix={[
							rmxCss({
								display: 'block',
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.text,
								marginBottom: spacing.xs,
							}),
						]}
					>
						Sort By
					</label>
					<select
						id="edit-feed-sort-fields"
						value={form.sortFields}
						mix={[
							rmxCss(inputStyles),
							rmxOn('input', (e) =>
								onSortFieldsChange((e.target as HTMLSelectElement).value),
							),
						]}
					>
						{isDirectory ? (
							<>
								<option value="publicationDate">Publication Date</option>
								<option value="title">Title</option>
								<option value="author">Author</option>
								<option value="trackNumber">Track Number</option>
								<option value="duration">Duration</option>
								<option value="filename">Filename</option>
								<option value="fileModifiedAt">Date Modified</option>
								<option value="size">File Size</option>
							</>
						) : (
							<>
								<option value="publicationDate">Publication Date</option>
								<option value="title">Title</option>
								<option value="author">Author</option>
								<option value="trackNumber">Track Number</option>
								<option value="duration">Duration</option>
								<option value="position">Manual Order</option>
								<option value="filename">Filename</option>
								<option value="fileModifiedAt">Date Modified</option>
								<option value="size">File Size</option>
							</>
						)}
					</select>
				</div>

				<div>
					<label
						for="edit-feed-sort-order"
						mix={[
							rmxCss({
								display: 'block',
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.text,
								marginBottom: spacing.xs,
							}),
						]}
					>
						Order
					</label>
					<select
						id="edit-feed-sort-order"
						value={form.sortOrder}
						mix={[
							rmxCss(inputStyles),
							rmxOn('input', (e) =>
								onSortOrderChange(
									(e.target as HTMLSelectElement).value as 'asc' | 'desc',
								),
							),
						]}
					>
						<option value="desc">Descending</option>
						<option value="asc">Ascending</option>
					</select>
				</div>
			</div>

			{error && (
				<div
					mix={[
						rmxCss({
							padding: spacing.sm,
							backgroundColor: 'rgba(239, 68, 68, 0.1)',
							borderRadius: radius.md,
							border: '1px solid rgba(239, 68, 68, 0.3)',
							marginBottom: spacing.md,
						}),
					]}
				>
					<p
						mix={[
							rmxCss({
								color: '#ef4444',
								margin: 0,
								fontSize: typography.fontSize.sm,
							}),
						]}
					>
						{error}
					</p>
				</div>
			)}

			<div
				mix={[
					rmxCss({
						display: 'flex',
						gap: spacing.sm,
						justifyContent: 'flex-end',
					}),
				]}
			>
				<button
					type="button"
					mix={[
						rmxCss({
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							backgroundColor: 'transparent',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							cursor: 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: colors.background,
							},
						}),
						rmxOn('click', onCancel),
					]}
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={isLoading}
					mix={[
						rmxCss({
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.background,
							backgroundColor: isLoading ? colors.border : colors.primary,
							border: 'none',
							borderRadius: radius.md,
							cursor: isLoading ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': isLoading
								? {}
								: { backgroundColor: colors.primaryHover },
						}),
						rmxOn('click', onSave),
					]}
				>
					{isLoading ? 'Saving...' : 'Save Changes'}
				</button>
			</div>
		</div>
	)
}

function DirectoryPathsEditor(handle: Handle) {
	let browseState: BrowseState = { status: 'idle' }
	let selectedRoot: string | null = null
	let currentPath = ''
	let entries: Array<DirectoryEntry> = []

	const fetchDirectory = async (root: string, path: string) => {
		browseState = { status: 'loading' }
		handle.update()

		try {
			const res = await fetch(
				`/admin/api/browse?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
			)
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`)
			}
			const data = await res.json()
			entries = data.entries || []
			browseState = { status: 'success', entries }
		} catch (err) {
			browseState = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to browse',
			}
		}
		handle.update()
	}

	const selectRoot = (rootName: string) => {
		selectedRoot = rootName
		currentPath = ''
		fetchDirectory(rootName, '')
	}

	const navigateToDir = (dirName: string) => {
		currentPath = currentPath ? `${currentPath}/${dirName}` : dirName
		if (selectedRoot) {
			fetchDirectory(selectedRoot, currentPath)
		}
	}

	const navigateUp = () => {
		const parts = currentPath.split('/').filter(Boolean)
		parts.pop()
		currentPath = parts.join('/')
		if (selectedRoot) {
			fetchDirectory(selectedRoot, currentPath)
		}
	}

	return (renderProps: {
		paths: Array<string>
		rootsState: RootsState
		onPathsChange: (paths: Array<string>) => void
	}) => {
		const { paths, rootsState, onPathsChange } = renderProps

		const addCurrentDirectory = () => {
			if (!selectedRoot) return
			const mediaPath = currentPath
				? `${selectedRoot}:${currentPath}`
				: selectedRoot
			onPathsChange([...paths, mediaPath])
			// Reset browser state
			selectedRoot = null
			currentPath = ''
			browseState = { status: 'idle' }
			handle.update()
		}

		const removePath = (index: number) => {
			const newPaths = paths.filter((_, i) => i !== index)
			onPathsChange(newPaths)
		}

		const isPathAdded = (mediaPath: string) => paths.includes(mediaPath)
		const currentMediaPath = selectedRoot
			? currentPath
				? `${selectedRoot}:${currentPath}`
				: selectedRoot
			: null

		return (
			<div mix={[rmxCss({ marginBottom: spacing.md })]}>
				<span
					mix={[
						rmxCss({
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}),
					]}
				>
					Directories <span mix={[rmxCss({ color: '#ef4444' })]}>*</span>
				</span>

				{/* Selected paths list */}
				{paths.length > 0 && (
					<div
						mix={[
							rmxCss({
								marginBottom: spacing.sm,
								padding: spacing.sm,
								backgroundColor: colors.background,
								borderRadius: radius.md,
								border: `1px solid ${colors.border}`,
							}),
						]}
					>
						<div
							mix={[
								rmxCss({
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									marginBottom: spacing.xs,
								}),
							]}
						>
							Selected ({paths.length})
						</div>
						{paths.map((path, index) => (
							<div
								key={path}
								mix={[
									rmxCss({
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
										padding: `${spacing.xs} ${spacing.sm}`,
										backgroundColor: colors.surface,
										borderRadius: radius.sm,
										marginBottom: index < paths.length - 1 ? spacing.xs : 0,
									}),
								]}
							>
								<span
									mix={[
										rmxCss({
											fontFamily: 'monospace',
											fontSize: typography.fontSize.sm,
											color: colors.primary,
										}),
									]}
								>
									{path}
								</span>
								<button
									type="button"
									mix={[
										rmxCss({
											color: '#ef4444',
											backgroundColor: 'transparent',
											border: 'none',
											cursor: 'pointer',
											fontSize: typography.fontSize.sm,
											'&:hover': {
												textDecoration: 'underline',
											},
										}),
										rmxOn('click', () => removePath(index)),
									]}
								>
									Remove
								</button>
							</div>
						))}
					</div>
				)}

				{/* Media root buttons */}
				{rootsState.status === 'success' && (
					<div mix={[rmxCss({ marginBottom: spacing.sm })]}>
						<div
							mix={[
								rmxCss({ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }),
							]}
						>
							{rootsState.roots.map((root) => (
								<button
									key={root.name}
									type="button"
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.sm}`,
											fontSize: typography.fontSize.sm,
											backgroundColor:
												selectedRoot === root.name
													? colors.primary
													: colors.surface,
											color:
												selectedRoot === root.name
													? colors.background
													: colors.text,
											border: `1px solid ${colors.border}`,
											borderRadius: radius.sm,
											cursor: 'pointer',
											'&:hover': {
												backgroundColor:
													selectedRoot === root.name
														? colors.primary
														: colors.background,
											},
										}),
										rmxOn('click', () => selectRoot(root.name)),
									]}
								>
									{root.name}
								</button>
							))}
						</div>
					</div>
				)}

				{/* Directory browser */}
				{selectedRoot && (
					<div
						mix={[
							rmxCss({
								border: `1px solid ${colors.border}`,
								borderRadius: radius.md,
								overflow: 'hidden',
							}),
						]}
					>
						<div
							mix={[
								rmxCss({
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									padding: spacing.sm,
									backgroundColor: colors.surface,
									borderBottom: `1px solid ${colors.border}`,
								}),
							]}
						>
							<span
								mix={[
									rmxCss({
										fontFamily: 'monospace',
										fontSize: typography.fontSize.sm,
										color: colors.primary,
									}),
								]}
							>
								{selectedRoot}/{currentPath}
							</span>
							{currentMediaPath && !isPathAdded(currentMediaPath) ? (
								<button
									type="button"
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.sm}`,
											fontSize: typography.fontSize.sm,
											backgroundColor: colors.primary,
											color: colors.background,
											border: 'none',
											borderRadius: radius.sm,
											cursor: 'pointer',
											'&:hover': {
												backgroundColor: colors.primaryHover,
											},
										}),
										rmxOn('click', addCurrentDirectory),
									]}
								>
									+ Add This Directory
								</button>
							) : (
								<span
									mix={[
										rmxCss({
											padding: `${spacing.xs} ${spacing.sm}`,
											fontSize: typography.fontSize.sm,
											color: colors.textMuted,
										}),
									]}
								>
									Added
								</span>
							)}
						</div>

						<div
							mix={[
								rmxCss({
									maxHeight: '200px',
									overflowY: 'auto',
									backgroundColor: colors.background,
								}),
							]}
						>
							{browseState.status === 'loading' && (
								<div
									mix={[
										rmxCss({
											padding: spacing.md,
											textAlign: 'center',
											color: colors.textMuted,
										}),
									]}
								>
									Loading...
								</div>
							)}

							{browseState.status === 'error' && (
								<div
									mix={[
										rmxCss({
											padding: spacing.md,
											textAlign: 'center',
											color: '#ef4444',
										}),
									]}
								>
									{browseState.message}
								</div>
							)}

							{browseState.status === 'success' && (
								<>
									{currentPath && (
										<button
											type="button"
											mix={[
												rmxCss({
													display: 'block',
													width: '100%',
													textAlign: 'left',
													padding: spacing.sm,
													backgroundColor: 'transparent',
													border: 'none',
													borderBottom: `1px solid ${colors.border}`,
													cursor: 'pointer',
													color: colors.textMuted,
													'&:hover': {
														backgroundColor: colors.surface,
													},
												}),
												rmxOn('click', navigateUp),
											]}
										>
											📁 ..
										</button>
									)}
									{entries
										.filter((e) => e.type === 'directory')
										.map((entry) => (
											<button
												key={entry.name}
												type="button"
												mix={[
													rmxCss({
														display: 'block',
														width: '100%',
														textAlign: 'left',
														padding: spacing.sm,
														backgroundColor: 'transparent',
														border: 'none',
														borderBottom: `1px solid ${colors.border}`,
														cursor: 'pointer',
														color: colors.text,
														'&:hover': {
															backgroundColor: colors.surface,
														},
													}),
													rmxOn('click', () => navigateToDir(entry.name)),
												]}
											>
												📁 {entry.name}
											</button>
										))}
									{entries.filter((e) => e.type === 'directory').length ===
										0 && (
										<div
											mix={[
												rmxCss({
													padding: spacing.md,
													textAlign: 'center',
													color: colors.textMuted,
													fontSize: typography.fontSize.sm,
												}),
											]}
										>
											No subdirectories
										</div>
									)}
								</>
							)}
						</div>
					</div>
				)}
			</div>
		)
	}
}

function DeleteConfirmModal() {
	return ({
		feedName,
		tokenCount,
		itemCount,
		isLoading,
		onConfirm,
		onCancel,
	}: {
		feedName: string
		tokenCount: number
		itemCount: number
		isLoading: boolean
		onConfirm: () => void
		onCancel: () => void
	}) => (
		<Modal
			title="Delete Feed"
			subtitle={`Are you sure you want to delete ${feedName}?`}
			size="sm"
			onClose={onCancel}
			showHeaderBorder={false}
			footer={
				<ModalFooter>
					<ModalButton
						variant="secondary"
						disabled={isLoading}
						onClick={onCancel}
					>
						Cancel
					</ModalButton>
					<ModalButton
						variant="danger"
						disabled={isLoading}
						onClick={onConfirm}
					>
						{isLoading ? 'Deleting...' : 'Delete Feed'}
					</ModalButton>
				</ModalFooter>
			}
		>
			<ModalAlert type="error">
				<p mix={[rmxCss({ margin: 0 })]}>
					This action cannot be undone. The following will be permanently
					deleted:
				</p>
				<ul
					mix={[
						rmxCss({
							margin: `${spacing.sm} 0 0 0`,
							paddingLeft: spacing.lg,
						}),
					]}
				>
					<li>The feed and all its settings</li>
					{tokenCount > 0 && (
						<li>
							{tokenCount} access token{tokenCount !== 1 ? 's' : ''}
						</li>
					)}
					{itemCount > 0 && (
						<li>
							{itemCount} media item reference{itemCount !== 1 ? 's' : ''}
						</li>
					)}
				</ul>
			</ModalAlert>
		</Modal>
	)
}

function AddFilesModal() {
	return ({
		rootsState,
		browseState,
		pickerRoot,
		pickerPath,
		selectedCount,
		isLoading,
		onSelectRoot,
		onNavigateToDir,
		onNavigateUp,
		onToggleFile,
		isFileSelected,
		isFileInFeed,
		onConfirm,
		onCancel,
	}: {
		rootsState: RootsState
		browseState: BrowseState
		pickerRoot: string | null
		pickerPath: string
		selectedCount: number
		isLoading: boolean
		onSelectRoot: (name: string) => void
		onNavigateToDir: (name: string) => void
		onNavigateUp: () => void
		onToggleFile: (filename: string) => void
		isFileSelected: (filename: string) => boolean
		isFileInFeed: (filename: string) => boolean
		onConfirm: () => void
		onCancel: () => void
	}) => {
		const pathParts = pickerPath ? pickerPath.split('/') : []

		return (
			<Modal
				title="Add Files to Feed"
				subtitle="Select media files to add to this feed. Files already in the feed are shown but disabled."
				size="lg"
				onClose={onCancel}
				footer={
					<div
						mix={[
							rmxCss({
								display: 'flex',
								gap: spacing.sm,
								justifyContent: 'space-between',
								alignItems: 'center',
								width: '100%',
							}),
						]}
					>
						<span
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
								}),
							]}
						>
							{selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
						</span>
						<ModalFooter>
							<ModalButton
								variant="secondary"
								disabled={isLoading}
								onClick={onCancel}
							>
								Cancel
							</ModalButton>
							<ModalButton
								variant="primary"
								disabled={isLoading || selectedCount === 0}
								onClick={onConfirm}
							>
								{isLoading
									? 'Adding...'
									: `Add ${selectedCount} File${selectedCount !== 1 ? 's' : ''}`}
							</ModalButton>
						</ModalFooter>
					</div>
				}
			>
				{/* File picker */}
				<div
					mix={[
						rmxCss({
							minHeight: '250px',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							overflow: 'hidden',
							display: 'flex',
							flexDirection: 'column',
						}),
					]}
				>
					{/* Root selector */}
					{rootsState.status === 'loading' && (
						<div mix={[rmxCss({ padding: spacing.lg, textAlign: 'center' })]}>
							<span mix={[rmxCss({ color: colors.textMuted })]}>
								Loading media roots...
							</span>
						</div>
					)}

					{rootsState.status === 'error' && (
						<div mix={[rmxCss({ padding: spacing.lg, textAlign: 'center' })]}>
							<span mix={[rmxCss({ color: '#ef4444' })]}>
								Error: {rootsState.message}
							</span>
						</div>
					)}

					{rootsState.status === 'success' && rootsState.roots.length === 0 && (
						<div
							mix={[
								rmxCss({
									padding: spacing.xl,
									textAlign: 'center',
									color: colors.textMuted,
								}),
							]}
						>
							<div
								mix={[
									rmxCss({
										width: '48px',
										height: '48px',
										margin: `0 auto ${spacing.md}`,
										borderRadius: radius.md,
										backgroundColor: colors.background,
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										fontSize: '24px',
									}),
								]}
							>
								📂
							</div>
							<p
								mix={[
									rmxCss({
										fontSize: typography.fontSize.base,
										fontWeight: typography.fontWeight.medium,
										color: colors.text,
										margin: `0 0 ${spacing.sm} 0`,
									}),
								]}
							>
								No media files available
							</p>
							<p
								mix={[
									rmxCss({
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										margin: 0,
										maxWidth: '400px',
										marginLeft: 'auto',
										marginRight: 'auto',
									}),
								]}
							>
								To add files to this feed, first add media files to one of your
								configured media path directories. Check your{' '}
								<code
									mix={[
										rmxCss({
											fontSize: typography.fontSize.xs,
											backgroundColor: colors.background,
											padding: `${spacing.xs} ${spacing.xs}`,
											borderRadius: radius.sm,
											fontFamily: 'monospace',
										}),
									]}
								>
									MEDIA_PATHS
								</code>{' '}
								environment variable to see where media should be stored.
							</p>
						</div>
					)}

					{rootsState.status === 'success' && rootsState.roots.length > 0 && (
						<>
							<div
								mix={[
									rmxCss({
										padding: spacing.sm,
										backgroundColor: colors.background,
										borderBottom: `1px solid ${colors.border}`,
										display: 'flex',
										gap: spacing.sm,
										flexWrap: 'wrap',
									}),
								]}
							>
								{rootsState.roots.map((root) => (
									<button
										key={root.name}
										type="button"
										mix={[
											rmxCss({
												padding: `${spacing.xs} ${spacing.sm}`,
												fontSize: typography.fontSize.xs,
												borderRadius: radius.sm,
												border: `1px solid ${pickerRoot === root.name ? colors.primary : colors.border}`,
												backgroundColor:
													pickerRoot === root.name
														? colors.primary
														: 'transparent',
												color:
													pickerRoot === root.name
														? colors.background
														: colors.text,
												cursor: 'pointer',
												transition: `all ${transitions.fast}`,
												'&:hover': {
													borderColor: colors.primary,
												},
											}),
											rmxOn('click', () => onSelectRoot(root.name)),
										]}
									>
										{root.name}
									</button>
								))}
							</div>

							{/* Path breadcrumb */}
							{pickerRoot && (
								<div
									mix={[
										rmxCss({
											padding: spacing.sm,
											backgroundColor: colors.background,
											borderBottom: `1px solid ${colors.border}`,
											fontSize: typography.fontSize.sm,
											fontFamily: 'monospace',
											color: colors.textMuted,
											display: 'flex',
											alignItems: 'center',
											gap: spacing.xs,
										}),
									]}
								>
									<span mix={[rmxCss({ color: colors.primary })]}>
										{pickerRoot}
									</span>
									{pathParts.map((part, i) => (
										<span key={i}>
											<span mix={[rmxCss({ color: colors.textMuted })]}>/</span>
											<span>{part}</span>
										</span>
									))}
									{!pickerPath && (
										<span mix={[rmxCss({ color: colors.textMuted })]}>/</span>
									)}
								</div>
							)}

							{/* File listing */}
							<div
								mix={[
									rmxCss({
										flex: 1,
										minHeight: '150px',
										maxHeight: '300px',
										overflowY: 'auto',
										backgroundColor: colors.surface,
									}),
								]}
							>
								{!pickerRoot && (
									<div
										mix={[
											rmxCss({
												padding: spacing.lg,
												textAlign: 'center',
												color: colors.textMuted,
											}),
										]}
									>
										Select a media root to browse files
									</div>
								)}

								{pickerRoot && browseState.status === 'loading' && (
									<div
										mix={[rmxCss({ padding: spacing.lg, textAlign: 'center' })]}
									>
										<span mix={[rmxCss({ color: colors.textMuted })]}>
											Loading...
										</span>
									</div>
								)}

								{pickerRoot && browseState.status === 'error' && (
									<div
										mix={[rmxCss({ padding: spacing.lg, textAlign: 'center' })]}
									>
										<span mix={[rmxCss({ color: '#ef4444' })]}>
											{browseState.message}
										</span>
									</div>
								)}

								{pickerRoot && browseState.status === 'success' && (
									<div>
										{pickerPath && (
											<button
												type="button"
												mix={[
													rmxCss(fileItemStyles),
													rmxOn('click', onNavigateUp),
												]}
											>
												<span mix={[rmxCss({ marginRight: spacing.sm })]}>
													📁
												</span>
												<span>..</span>
											</button>
										)}

										{browseState.entries.length === 0 && !pickerPath && (
											<div
												mix={[
													rmxCss({
														padding: spacing.xl,
														textAlign: 'center',
														color: colors.textMuted,
													}),
												]}
											>
												<div
													mix={[
														rmxCss({
															width: '40px',
															height: '40px',
															margin: `0 auto ${spacing.sm}`,
															borderRadius: radius.md,
															backgroundColor: colors.background,
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'center',
															fontSize: '20px',
														}),
													]}
												>
													📂
												</div>
												<p
													mix={[
														rmxCss({
															fontSize: typography.fontSize.sm,
															fontWeight: typography.fontWeight.medium,
															color: colors.text,
															margin: `0 0 ${spacing.xs} 0`,
														}),
													]}
												>
													No files in this directory
												</p>
												<p
													mix={[
														rmxCss({
															fontSize: typography.fontSize.xs,
															color: colors.textMuted,
															margin: 0,
														}),
													]}
												>
													Add media files to{' '}
													<code
														mix={[
															rmxCss({
																fontFamily: 'monospace',
																backgroundColor: colors.background,
																padding: `0 ${spacing.xs}`,
																borderRadius: radius.sm,
															}),
														]}
													>
														{pickerRoot}
													</code>{' '}
													to see them here.
												</p>
											</div>
										)}

										{/* Directories */}
										{browseState.entries
											.filter((e) => e.type === 'directory')
											.map((entry) => (
												<button
													key={entry.name}
													type="button"
													mix={[
														rmxCss(fileItemStyles),
														rmxOn('click', () => onNavigateToDir(entry.name)),
													]}
												>
													<span mix={[rmxCss({ marginRight: spacing.sm })]}>
														📁
													</span>
													<span>{entry.name}</span>
												</button>
											))}

										{/* Files with checkboxes */}
										{browseState.entries
											.filter((e) => e.type === 'file')
											.map((entry) => {
												const selected = isFileSelected(entry.name)
												const inFeed = isFileInFeed(entry.name)
												return (
													<button
														key={entry.name}
														type="button"
														disabled={inFeed}
														mix={[
															rmxCss({
																...fileItemStyles,
																backgroundColor: selected
																	? colors.primarySoft
																	: inFeed
																		? 'rgba(128, 128, 128, 0.05)'
																		: 'transparent',
																opacity: inFeed ? 0.5 : 1,
																cursor: inFeed ? 'not-allowed' : 'pointer',
															}),
															rmxOn('click', () => {
																if (!inFeed) onToggleFile(entry.name)
															}),
														]}
													>
														<span
															mix={[
																rmxCss({
																	marginRight: spacing.sm,
																	width: '16px',
																	height: '16px',
																	border: `1px solid ${inFeed ? colors.border : selected ? colors.primary : colors.border}`,
																	borderRadius: radius.sm,
																	backgroundColor: inFeed
																		? colors.border
																		: selected
																			? colors.primary
																			: 'transparent',
																	display: 'inline-flex',
																	alignItems: 'center',
																	justifyContent: 'center',
																	fontSize: '12px',
																	color: colors.background,
																}),
															]}
														>
															{(selected || inFeed) && '✓'}
														</span>
														<span mix={[rmxCss({ marginRight: spacing.sm })]}>
															📄
														</span>
														<span>{entry.name}</span>
														{inFeed && (
															<span
																mix={[
																	rmxCss({
																		marginLeft: 'auto',
																		fontSize: typography.fontSize.xs,
																		color: colors.textMuted,
																	}),
																]}
															>
																Already in feed
															</span>
														)}
													</button>
												)
											})}
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</Modal>
		)
	}
}

const fileItemStyles = {
	display: 'flex',
	alignItems: 'center',
	width: '100%',
	padding: `${spacing.sm} ${spacing.md}`,
	fontSize: typography.fontSize.sm,
	color: colors.text,
	backgroundColor: 'transparent',
	border: 'none',
	borderBottom: `1px solid ${colors.border}`,
	cursor: 'pointer',
	textAlign: 'left' as const,
	transition: `background-color ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.background,
	},
	'&:last-child': {
		borderBottom: 'none',
	},
}

function FeedAnalyticsSection() {
	return ({ analyticsState }: { analyticsState: AnalyticsLoadingState }) => {
		if (analyticsState.status === 'loading') {
			return (
				<p
					mix={[
						rmxCss({
							margin: 0,
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
						}),
					]}
				>
					Loading analytics...
				</p>
			)
		}

		if (analyticsState.status === 'error') {
			return (
				<p
					mix={[
						rmxCss({
							margin: 0,
							fontSize: typography.fontSize.sm,
							color: '#ef4444',
						}),
					]}
				>
					Unable to load analytics: {analyticsState.message}
				</p>
			)
		}

		const { summary, byToken, topMediaItems, topClients, daily } =
			analyticsState.data
		return (
			<div
				mix={[
					rmxCss({
						display: 'flex',
						flexDirection: 'column',
						gap: spacing.lg,
					}),
				]}
			>
				<div
					mix={[
						rmxCss({
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
							gap: spacing.sm,
						}),
					]}
				>
					<AnalyticsMetricCard
						label="RSS Fetches"
						value={summary.rssFetches.toLocaleString()}
					/>
					<AnalyticsMetricCard
						label="Media Requests"
						value={summary.mediaRequests.toLocaleString()}
					/>
					<AnalyticsMetricCard
						label="Download Starts"
						value={summary.downloadStarts.toLocaleString()}
					/>
					<AnalyticsMetricCard
						label="Unique Clients"
						value={summary.uniqueClients.toLocaleString()}
					/>
					<AnalyticsMetricCard
						label="Bytes Served"
						value={formatFileSize(summary.bytesServed)}
					/>
				</div>

				<div>
					<h4
						mix={[
							rmxCss({
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.semibold,
								margin: `0 0 ${spacing.sm} 0`,
								color: colors.text,
							}),
						]}
					>
						By Token
					</h4>
					{byToken.length === 0 ? (
						<p
							mix={[
								rmxCss({
									margin: 0,
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
								}),
							]}
						>
							No token analytics yet.
						</p>
					) : (
						<div mix={[rmxCss({ overflowX: 'auto' })]}>
							<table
								mix={[
									rmxCss({
										width: '100%',
										borderCollapse: 'collapse',
										fontSize: typography.fontSize.xs,
									}),
								]}
							>
								<thead>
									<tr
										mix={[
											rmxCss({ borderBottom: `1px solid ${colors.border}` }),
										]}
									>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Token</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>RSS</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Requests</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Starts</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Clients</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Bytes</th>
										<th mix={[rmxCss(analyticsCellHeaderStyle)]}>Last Seen</th>
									</tr>
								</thead>
								<tbody>
									{byToken.map((token) => (
										<tr
											key={token.token}
											mix={[
												rmxCss({ borderBottom: `1px solid ${colors.border}` }),
											]}
										>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												<div>
													<div>{token.label || 'Unlabeled token'}</div>
													<div
														mix={[
															rmxCss({
																color: colors.textMuted,
																fontFamily: 'monospace',
																fontSize: typography.fontSize.xs,
															}),
														]}
													>
														{token.token.slice(0, 10)}...
													</div>
												</div>
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{token.rssFetches.toLocaleString()}
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{token.mediaRequests.toLocaleString()}
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{token.downloadStarts.toLocaleString()}
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{token.uniqueClients.toLocaleString()}
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{formatFileSize(token.bytesServed)}
											</td>
											<td mix={[rmxCss(analyticsCellStyle)]}>
												{formatRelativeTime(token.lastSeenAt)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				<div
					mix={[
						rmxCss({
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
							gap: spacing.lg,
						}),
					]}
				>
					<AnalyticsTopClientsList clients={topClients} />

					<div>
						<h4
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.semibold,
									margin: `0 0 ${spacing.sm} 0`,
									color: colors.text,
								}),
							]}
						>
							Top Media Items
						</h4>
						{topMediaItems.length === 0 ? (
							<p
								mix={[
									rmxCss({
										margin: 0,
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
									}),
								]}
							>
								No media request analytics yet.
							</p>
						) : (
							<ul
								mix={[
									rmxCss({
										listStyle: 'none',
										padding: 0,
										margin: 0,
										display: 'flex',
										flexDirection: 'column',
										gap: spacing.sm,
									}),
								]}
							>
								{topMediaItems.slice(0, 8).map((item) => (
									<li
										key={`${item.mediaRoot}:${item.relativePath}`}
										mix={[
											rmxCss({
												padding: spacing.sm,
												borderRadius: radius.md,
												border: `1px solid ${colors.border}`,
												backgroundColor: colors.background,
											}),
										]}
									>
										<a
											href={`/admin/media/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
											mix={[
												rmxCss({
													color: colors.primary,
													textDecoration: 'none',
													fontSize: typography.fontSize.sm,
													fontWeight: typography.fontWeight.medium,
												}),
											]}
										>
											{item.relativePath.split('/').at(-1) ?? item.relativePath}
										</a>
										<div
											mix={[
												rmxCss({
													marginTop: spacing.xs,
													fontSize: typography.fontSize.xs,
													color: colors.textMuted,
													display: 'flex',
													gap: spacing.sm,
													flexWrap: 'wrap',
												}),
											]}
										>
											<span>{item.downloadStarts} starts</span>
											<span>{item.mediaRequests} requests</span>
											<span>{formatFileSize(item.bytesServed)}</span>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<AnalyticsDailyActivityChart daily={daily} />
				</div>
			</div>
		)
	}
}

const analyticsCellHeaderStyle = {
	textAlign: 'left' as const,
	padding: `${spacing.xs} ${spacing.sm}`,
	color: colors.textMuted,
	fontWeight: typography.fontWeight.medium,
	fontSize: typography.fontSize.xs,
	textTransform: 'uppercase' as const,
	letterSpacing: '0.05em',
}

const analyticsCellStyle = {
	padding: `${spacing.xs} ${spacing.sm}`,
	fontSize: typography.fontSize.xs,
	color: colors.text,
}
