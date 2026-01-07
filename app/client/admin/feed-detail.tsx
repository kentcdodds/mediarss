import type { Handle } from '@remix-run/component'
import {
	formatDate,
	formatDuration,
	formatFileSize,
	formatRelativeTime,
} from '#app/helpers/format.ts'
import {
	colors,
	mq,
	radius,
	responsive,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'
import { Link } from './router.tsx'

type DirectoryFeed = {
	id: string
	name: string
	description: string
	directoryPaths: string // JSON array of "mediaRoot:relativePath" strings
	sortFields: string
	sortOrder: 'asc' | 'desc'
	imageUrl: string | null
	type: 'directory'
	createdAt: number
	updatedAt: number
}

type CuratedFeed = {
	id: string
	name: string
	description: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
	imageUrl: string | null
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

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: FeedResponse }

type EditFormState = {
	name: string
	description: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
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
export function FeedDetail(this: Handle) {
	let state: LoadingState = { status: 'loading' }
	let copiedToken: string | null = null
	let showCreateForm = false
	let newTokenLabel = ''
	let createLoading = false
	let feedId = ''

	// Edit mode state
	let isEditing = false
	let editForm: EditFormState = {
		name: '',
		description: '',
		sortFields: '',
		sortOrder: 'asc',
		directoryPaths: [],
	}
	let editLoading = false
	let editError: string | null = null

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
	let imageUrlInput = ''
	let imageUrlSaving = false
	let artworkImageKey = 0 // Used to force image refresh after upload

	// Fetch media roots for file picker
	fetch('/admin/api/directories', { signal: this.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<{ roots: Array<MediaRoot> }>
		})
		.then((data) => {
			rootsState = { status: 'success', roots: data.roots }
			this.update()
		})
		.catch((err) => {
			if (this.signal.aborted) return
			rootsState = { status: 'error', message: err.message }
			this.update()
		})

	// Browse a directory for the file picker
	const browse = (rootName: string, path: string) => {
		browseState = { status: 'loading' }
		this.update()

		const params = new URLSearchParams({ root: rootName, path })
		fetch(`/admin/api/browse?${params}`, { signal: this.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<{ entries: Array<DirectoryEntry> }>
			})
			.then((data) => {
				browseState = { status: 'success', entries: data.entries }
				this.update()
			})
			.catch((err) => {
				if (this.signal.aborted) return
				browseState = { status: 'error', message: err.message }
				this.update()
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
		this.update()
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
		this.update()

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
		this.update()
	}

	const confirmAddFiles = async () => {
		if (selectedFilePaths.length === 0) return
		await addItems(selectedFilePaths)
		selectedFilePaths = []
	}

	const fetchFeed = (id: string) => {
		feedId = id
		state = { status: 'loading' }
		this.update()

		fetch(`/admin/api/feeds/${id}`, { signal: this.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<FeedResponse>
			})
			.then((data) => {
				state = { status: 'success', data }
				// Initialize imageUrl input with current value
				imageUrlInput = data.feed.imageUrl ?? ''
				// Use feed's updatedAt as cache buster for artwork
				artworkImageKey = data.feed.updatedAt
				artworkError = null
				this.update()
			})
			.catch((err) => {
				if (this.signal.aborted) return
				state = { status: 'error', message: err.message }
				this.update()
			})
	}

	const copyFeedUrl = async (token: string) => {
		const url = `${window.location.origin}/feed/${token}`
		try {
			await navigator.clipboard.writeText(url)
			copiedToken = token
			this.update()
			setTimeout(() => {
				copiedToken = null
				this.update()
			}, 2000)
		} catch {
			console.error('Failed to copy to clipboard text:', url)
		}
	}

	const createToken = async () => {
		createLoading = true
		this.update()

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
			this.update()
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

	const startEditing = (feed: Feed) => {
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
			sortFields: feed.sortFields,
			sortOrder: feed.sortOrder,
			directoryPaths,
		}
		editError = null
		isEditing = true
		this.update()
	}

	const cancelEditing = () => {
		isEditing = false
		editError = null
		this.update()
	}

	const saveEdit = async (isDirectory: boolean) => {
		if (!editForm.name.trim()) {
			editError = 'Name is required'
			this.update()
			return
		}

		if (isDirectory && editForm.directoryPaths.length === 0) {
			editError = 'At least one directory is required'
			this.update()
			return
		}

		editLoading = true
		editError = null
		this.update()

		try {
			const body: Record<string, unknown> = {
				name: editForm.name.trim(),
				description: editForm.description.trim(),
				sortFields: editForm.sortFields,
				sortOrder: editForm.sortOrder,
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

			isEditing = false
			fetchFeed(feedId)
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Failed to update feed'
			this.update()
		} finally {
			editLoading = false
			this.update()
		}
	}

	const deleteFeed = async () => {
		deleteLoading = true
		this.update()

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
			this.update()
		}
	}

	// Artwork management functions
	const uploadArtwork = async (file: File) => {
		artworkUploadLoading = true
		artworkError = null
		this.update()

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
			this.update()
		} finally {
			artworkUploadLoading = false
			this.update()
		}
	}

	const deleteArtwork = async () => {
		artworkDeleteLoading = true
		artworkError = null
		this.update()

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
			this.update()
		} finally {
			artworkDeleteLoading = false
			this.update()
		}
	}

	const saveImageUrl = async () => {
		imageUrlSaving = true
		artworkError = null
		this.update()

		try {
			const newImageUrl = imageUrlInput.trim() || null
			const res = await fetch(`/admin/api/feeds/${feedId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageUrl: newImageUrl }),
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
				err instanceof Error ? err.message : 'Failed to save image URL'
			this.update()
		} finally {
			imageUrlSaving = false
			this.update()
		}
	}

	const clearImageUrl = async () => {
		imageUrlInput = ''
		imageUrlSaving = true
		artworkError = null
		this.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageUrl: null }),
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
				err instanceof Error ? err.message : 'Failed to clear image URL'
			this.update()
		} finally {
			imageUrlSaving = false
			this.update()
		}
	}

	// Item management functions (curated feeds only)
	const removeItem = async (item: MediaItem) => {
		itemActionLoading = true
		this.update()

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
			this.update()
		}
	}

	const moveItem = async (
		items: Array<MediaItem>,
		fromIndex: number,
		toIndex: number,
	) => {
		if (toIndex < 0 || toIndex >= items.length) return

		itemActionLoading = true
		this.update()

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
			this.update()
		}
	}

	// Drag-and-drop handlers
	const handleDragStart = (index: number) => {
		draggingIndex = index
		this.update()
	}

	const handleDragOver = (e: DragEvent, index: number) => {
		e.preventDefault()
		if (draggingIndex === null || draggingIndex === index) return
		if (dragOverIndex !== index) {
			dragOverIndex = index
			this.update()
		}
	}

	const handleDragLeave = () => {
		dragOverIndex = null
		this.update()
	}

	const handleDrop = async (items: Array<MediaItem>, targetIndex: number) => {
		if (draggingIndex === null || draggingIndex === targetIndex) {
			draggingIndex = null
			dragOverIndex = null
			this.update()
			return
		}

		const fromIndex = draggingIndex
		draggingIndex = null
		dragOverIndex = null
		this.update()

		await moveItem(items, fromIndex, targetIndex)
	}

	const handleDragEnd = () => {
		draggingIndex = null
		dragOverIndex = null
		this.update()
	}

	const addItems = async (paths: Array<string>) => {
		if (paths.length === 0) return

		itemActionLoading = true
		this.update()

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
			this.update()
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
							this.update()
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
					css={{
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
					}}
				>
					<div
						css={{
							display: 'flex',
							alignItems: 'center',
							gap: spacing.md,
							flex: 1,
							minWidth: 0,
							[mq.mobile]: {
								flexWrap: 'wrap',
							},
						}}
					>
						<Link
							href="/admin"
							css={{
								color: colors.textMuted,
								textDecoration: 'none',
								fontSize: typography.fontSize.sm,
								'&:hover': { color: colors.text },
								flexShrink: 0,
							}}
						>
							← Back
						</Link>
						<h2
							css={{
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
							}}
						>
							{feed.name}
						</h2>
						<span
							css={{
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
							}}
						>
							{feed.type}
						</span>
					</div>
					{!isEditing && (
						<div
							css={{
								display: 'flex',
								gap: spacing.sm,
								[mq.mobile]: {
									width: '100%',
								},
							}}
						>
							<button
								type="button"
								css={{
									padding: `${spacing.xs} ${spacing.md}`,
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
									color: colors.primary,
									backgroundColor: 'transparent',
									border: `1px solid ${colors.primary}`,
									borderRadius: radius.md,
									cursor: 'pointer',
									transition: `all ${transitions.fast}`,
									'&:hover': {
										backgroundColor: colors.primarySoft,
									},
									[mq.mobile]: {
										flex: 1,
									},
								}}
								on={{ click: () => startEditing(feed) }}
							>
								Edit
							</button>
							<button
								type="button"
								css={{
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
								}}
								on={{
									click: () => {
										showDeleteConfirm = true
										this.update()
									},
								}}
							>
								Delete
							</button>
						</div>
					)}
				</div>

				{/* Feed Info Card */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: responsive.spacingSection,
						marginBottom: spacing.xl,
						boxShadow: shadows.sm,
					}}
				>
					<div
						css={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							marginBottom: spacing.md,
						}}
					>
						<h3
							css={{
								fontSize: typography.fontSize.base,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
							}}
						>
							Feed Details
						</h3>
					</div>

					{isEditing ? (
						<EditForm
							form={editForm}
							isDirectory={isDirectory}
							isLoading={editLoading}
							error={editError}
							onNameChange={(value) => {
								editForm.name = value
								this.update()
							}}
							onDescriptionChange={(value) => {
								editForm.description = value
								this.update()
							}}
							onSortFieldsChange={(value) => {
								editForm.sortFields = value
								this.update()
							}}
							onSortOrderChange={(value) => {
								editForm.sortOrder = value
								this.update()
							}}
							onSave={() => saveEdit(isDirectory)}
							onDirectoryPathsChange={
								isDirectory
									? (paths) => {
											editForm.directoryPaths = paths
											this.update()
										}
									: undefined
							}
							rootsState={rootsState}
							onCancel={cancelEditing}
						/>
					) : (
						<>
							{feed.description && (
								<p
									css={{
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										margin: `0 0 ${spacing.md} 0`,
									}}
								>
									{feed.description}
								</p>
							)}

							<div
								css={{
									display: 'grid',
									gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
									gap: spacing.md,
								}}
							>
								{isDirectory && (
									<DirectoriesInfo
										directoryPaths={(feed as DirectoryFeed).directoryPaths}
									/>
								)}
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
									value={formatDate(feed.createdAt, 'short')}
								/>
								<InfoItem
									label="Updated"
									value={formatDate(feed.updatedAt, 'short')}
								/>
							</div>
						</>
					)}
				</div>

				{/* Feed Artwork Section */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: responsive.spacingSection,
						marginBottom: spacing.xl,
						boxShadow: shadows.sm,
					}}
				>
					<h3
						css={{
							fontSize: typography.fontSize.base,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: `0 0 ${spacing.md} 0`,
						}}
					>
						Feed Artwork
					</h3>

					<div
						css={{
							display: 'flex',
							gap: spacing.lg,
							flexWrap: 'wrap',
							alignItems: 'flex-start',
						}}
					>
						{/* Artwork Preview */}
						<div css={{ flexShrink: 0 }}>
							<img
								key={artworkImageKey}
								src={`/admin/api/feeds/${feed.id}/artwork?t=${artworkImageKey}`}
								alt="Feed artwork"
								css={{
									width: '120px',
									height: '120px',
									borderRadius: radius.md,
									objectFit: 'cover',
									backgroundColor: colors.background,
									border: `1px solid ${colors.border}`,
								}}
								on={{
									error: (e: Event) => {
										// Fallback to placeholder if no artwork
										const img = e.target as HTMLImageElement
										img.src = `data:image/svg+xml,${encodeURIComponent(
											`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#1a1a2e"/><text x="60" y="72" font-family="system-ui" font-size="48" font-weight="bold" fill="#e94560" text-anchor="middle">${feed.name.trim()[0]?.toUpperCase() ?? '?'}</text></svg>`,
										)}`
									},
								}}
							/>
						</div>

						{/* Artwork Controls */}
						<div css={{ flex: 1, minWidth: '280px' }}>
							{/* Current Source Indicator */}
							<div
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									marginBottom: spacing.md,
								}}
							>
								<strong>Current source:</strong>{' '}
								{state.status === 'success' && state.data.hasUploadedArtwork
									? 'Uploaded artwork'
									: feed.imageUrl
										? 'External URL'
										: 'Generated placeholder'}
							</div>

							{/* Upload Button */}
							<div css={{ marginBottom: spacing.md }}>
								<input
									type="file"
									id="artwork-upload"
									accept="image/jpeg,image/png,image/webp"
									css={{ display: 'none' }}
									on={{
										change: (e) => {
											const input = e.target as HTMLInputElement
											const file = input.files?.[0]
											if (file) {
												uploadArtwork(file)
												input.value = '' // Reset for re-upload
											}
										},
									}}
								/>
								<div
									css={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}
								>
									<label
										for="artwork-upload"
										css={{
											display: 'inline-block',
											padding: `${spacing.xs} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											color: colors.background,
											backgroundColor: artworkUploadLoading
												? colors.border
												: colors.primary,
											borderRadius: radius.md,
											cursor: artworkUploadLoading ? 'not-allowed' : 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': artworkUploadLoading
												? {}
												: { backgroundColor: colors.primaryHover },
										}}
									>
										{artworkUploadLoading ? 'Uploading...' : 'Upload Artwork'}
									</label>
									{state.status === 'success' &&
										state.data.hasUploadedArtwork && (
											<button
												type="button"
												disabled={artworkDeleteLoading}
												css={{
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
												}}
												on={{ click: deleteArtwork }}
											>
												{artworkDeleteLoading
													? 'Removing...'
													: 'Remove Uploaded'}
											</button>
										)}
								</div>
								<p
									css={{
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										margin: `${spacing.xs} 0 0 0`,
									}}
								>
									JPEG, PNG, or WebP. Max 5MB.
								</p>
							</div>

							{/* External URL Input */}
							<div css={{ marginBottom: spacing.sm }}>
								<label
									for="artwork-url"
									css={{
										display: 'block',
										fontSize: typography.fontSize.sm,
										fontWeight: typography.fontWeight.medium,
										color: colors.text,
										marginBottom: spacing.xs,
									}}
								>
									External URL (optional)
								</label>
								<div css={{ display: 'flex', gap: spacing.sm }}>
									<input
										id="artwork-url"
										type="url"
										value={imageUrlInput}
										placeholder="https://example.com/artwork.jpg"
										css={{
											flex: 1,
											padding: spacing.sm,
											fontSize: typography.fontSize.sm,
											color: colors.text,
											backgroundColor: colors.background,
											border: `1px solid ${colors.border}`,
											borderRadius: radius.md,
											outline: 'none',
											'&:focus': { borderColor: colors.primary },
											'&::placeholder': { color: colors.textMuted },
										}}
										on={{
											input: (e) => {
												imageUrlInput = (e.target as HTMLInputElement).value
												this.update()
											},
											focus: () => {
												// Initialize with current value on focus if empty
												if (!imageUrlInput && feed.imageUrl) {
													imageUrlInput = feed.imageUrl
													this.update()
												}
											},
										}}
									/>
									<button
										type="button"
										disabled={
											imageUrlSaving || imageUrlInput === (feed.imageUrl ?? '')
										}
										css={{
											padding: `${spacing.xs} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											color: colors.background,
											backgroundColor:
												imageUrlSaving ||
												imageUrlInput === (feed.imageUrl ?? '')
													? colors.border
													: colors.primary,
											border: 'none',
											borderRadius: radius.md,
											cursor:
												imageUrlSaving ||
												imageUrlInput === (feed.imageUrl ?? '')
													? 'not-allowed'
													: 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover':
												imageUrlSaving ||
												imageUrlInput === (feed.imageUrl ?? '')
													? {}
													: { backgroundColor: colors.primaryHover },
										}}
										on={{ click: () => saveImageUrl() }}
									>
										{imageUrlSaving ? 'Saving...' : 'Save'}
									</button>
									{feed.imageUrl && (
										<button
											type="button"
											disabled={imageUrlSaving}
											css={{
												padding: `${spacing.xs} ${spacing.md}`,
												fontSize: typography.fontSize.sm,
												fontWeight: typography.fontWeight.medium,
												color: '#ef4444',
												backgroundColor: 'transparent',
												border: '1px solid #ef4444',
												borderRadius: radius.md,
												cursor: imageUrlSaving ? 'not-allowed' : 'pointer',
												transition: `all ${transitions.fast}`,
												'&:hover': imageUrlSaving
													? {}
													: { backgroundColor: 'rgba(239, 68, 68, 0.1)' },
											}}
											on={{ click: clearImageUrl }}
										>
											Clear
										</button>
									)}
								</div>
							</div>

							{/* Error Message */}
							{artworkError && (
								<div
									css={{
										padding: spacing.sm,
										backgroundColor: 'rgba(239, 68, 68, 0.1)',
										borderRadius: radius.md,
										border: '1px solid rgba(239, 68, 68, 0.3)',
										marginBottom: spacing.sm,
									}}
								>
									<p
										css={{
											color: '#ef4444',
											margin: 0,
											fontSize: typography.fontSize.sm,
										}}
									>
										{artworkError}
									</p>
								</div>
							)}

							{/* Priority Note */}
							<p
								css={{
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									margin: 0,
									fontStyle: 'italic',
								}}
							>
								Uploaded artwork takes priority over external URL.
							</p>
						</div>
					</div>
				</div>

				{/* Media Items Section */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: responsive.spacingSection,
						marginBottom: spacing.xl,
						boxShadow: shadows.sm,
					}}
				>
					<div
						css={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							marginBottom: spacing.lg,
						}}
					>
						<h3
							css={{
								fontSize: typography.fontSize.base,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
							}}
						>
							Media Items ({items.length})
						</h3>
						{!isDirectory && (
							<button
								type="button"
								css={{
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
								}}
								on={{ click: openAddFilesModal }}
							>
								+ Add Files
							</button>
						)}
					</div>

					{items.length === 0 ? (
						<div
							css={{
								textAlign: 'center',
								padding: spacing.xl,
								color: colors.textMuted,
							}}
						>
							<p css={{ margin: 0 }}>No media items found in this feed.</p>
						</div>
					) : (
						<div
							css={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '400px' }}
						>
							<table
								css={{
									width: '100%',
									borderCollapse: 'collapse',
									fontSize: typography.fontSize.sm,
								}}
							>
								<thead
									css={{
										position: 'sticky',
										top: 0,
										backgroundColor: colors.surface,
										zIndex: 1,
									}}
								>
									<tr
										css={{
											borderBottom: `1px solid ${colors.border}`,
										}}
									>
										{isManualSort && (
											<th
												css={{
													width: '32px',
													padding: `${spacing.sm} ${spacing.xs}`,
												}}
											/>
										)}
										<th
											css={{
												textAlign: 'left',
												padding: `${spacing.sm} ${spacing.md}`,
												color: colors.textMuted,
												fontWeight: typography.fontWeight.medium,
												fontSize: typography.fontSize.xs,
												textTransform: 'uppercase',
												letterSpacing: '0.05em',
												width: '40px',
											}}
										>
											#
										</th>
										<th
											css={{
												width: '48px',
												padding: `${spacing.sm}`,
											}}
										/>
										<th
											css={{
												textAlign: 'left',
												padding: `${spacing.sm} ${spacing.md}`,
												color: colors.textMuted,
												fontWeight: typography.fontWeight.medium,
												fontSize: typography.fontSize.xs,
												textTransform: 'uppercase',
												letterSpacing: '0.05em',
											}}
										>
											Title
										</th>
										<th
											css={{
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
											}}
										>
											Author
										</th>
										<th
											css={{
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
											}}
										>
											Duration
										</th>
										<th
											css={{
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
											}}
										>
											Size
										</th>
										{extraSortColumn && (
											<th
												css={{
													textAlign: 'left',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.primary,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													backgroundColor: colors.primarySoft,
													whiteSpace: 'nowrap',
												}}
												title={`Sorted by ${getSortFieldLabel(extraSortColumn)}`}
											>
												{getSortFieldLabel(extraSortColumn)} ↓
											</th>
										)}
										{isCurated && (
											<th
												css={{
													textAlign: 'center',
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontWeight: typography.fontWeight.medium,
													fontSize: typography.fontSize.xs,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
													width: isManualSort ? '120px' : '60px',
												}}
											>
												Actions
											</th>
										)}
										<th
											css={{
												textAlign: 'center',
												padding: `${spacing.sm} ${spacing.md}`,
												width: '60px',
											}}
										/>
									</tr>
								</thead>
								<tbody>
									{items.map((item, index) => (
										<tr
											key={toMediaPath(item)}
											draggable={isManualSort}
											css={{
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
											}}
											on={
												isManualSort
													? {
															dragstart: () => handleDragStart(index),
															dragover: (e: DragEvent) =>
																handleDragOver(e, index),
															dragleave: handleDragLeave,
															drop: () => handleDrop(items, index),
															dragend: handleDragEnd,
														}
													: undefined
											}
										>
											{isManualSort && (
												<td
													css={{
														padding: `${spacing.sm} ${spacing.xs}`,
														color: colors.textMuted,
														cursor: 'grab',
														textAlign: 'center',
														userSelect: 'none',
													}}
												>
													<span css={{ fontSize: typography.fontSize.sm }}>
														⋮⋮
													</span>
												</td>
											)}
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													fontFamily: 'monospace',
													fontSize: typography.fontSize.xs,
												}}
											>
												{index + 1}
											</td>
											<td css={{ padding: spacing.sm, textAlign: 'center' }}>
												<img
													src={`/admin/api/artwork/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
													alt=""
													loading="lazy"
													css={{
														width: '32px',
														height: '32px',
														borderRadius: radius.sm,
														objectFit: 'cover',
														backgroundColor: colors.background,
													}}
												/>
											</td>
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.text,
													maxWidth: '300px',
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}
												title={item.title}
											>
												{item.title}
											</td>
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													maxWidth: '200px',
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
													[mq.mobile]: {
														display: 'none',
													},
												}}
												title={item.author ?? undefined}
											>
												{item.author || '—'}
											</td>
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													textAlign: 'right',
													fontFamily: 'monospace',
													fontSize: typography.fontSize.xs,
													[mq.mobile]: {
														display: 'none',
													},
												}}
											>
												{formatDuration(item.duration)}
											</td>
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													color: colors.textMuted,
													textAlign: 'right',
													fontFamily: 'monospace',
													fontSize: typography.fontSize.xs,
													[mq.mobile]: {
														display: 'none',
													},
												}}
											>
												{formatFileSize(item.sizeBytes)}
											</td>
											{extraSortColumn && (
												<td
													css={{
														padding: `${spacing.sm} ${spacing.md}`,
														color: colors.text,
														fontSize: typography.fontSize.xs,
														backgroundColor: colors.primarySoftest,
														whiteSpace: 'nowrap',
													}}
													title={formatSortValue(item, extraSortColumn)}
												>
													{formatSortValue(item, extraSortColumn)}
												</td>
											)}
											{isCurated && (
												<td
													css={{
														padding: `${spacing.sm} ${spacing.md}`,
														textAlign: 'center',
													}}
												>
													<div
														css={{
															display: 'flex',
															gap: spacing.xs,
															justifyContent: 'center',
															alignItems: 'center',
														}}
													>
														{isManualSort && (
															<>
																<button
																	type="button"
																	disabled={index === 0 || itemActionLoading}
																	title="Move up"
																	css={{
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
																	}}
																	on={{
																		click: () =>
																			moveItem(items, index, index - 1),
																	}}
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
																	css={{
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
																	}}
																	on={{
																		click: () =>
																			moveItem(items, index, index + 1),
																	}}
																>
																	↓
																</button>
															</>
														)}
														<button
															type="button"
															disabled={itemActionLoading}
															title="Remove"
															css={{
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
																			backgroundColor: 'rgba(239, 68, 68, 0.1)',
																		},
															}}
															on={{ click: () => removeItem(item) }}
														>
															×
														</button>
													</div>
												</td>
											)}
											<td
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													textAlign: 'center',
												}}
											>
												<Link
													href={`/admin/media/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
													css={{
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
													}}
												>
													View
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Tokens Section */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: responsive.spacingSection,
						boxShadow: shadows.sm,
					}}
				>
					<div
						css={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							marginBottom: spacing.lg,
						}}
					>
						<h3
							css={{
								fontSize: typography.fontSize.base,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
							}}
						>
							Access Tokens ({activeTokens.length})
						</h3>
						{!showCreateForm && (
							<button
								type="button"
								css={{
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
								}}
								on={{
									click: () => {
										showCreateForm = true
										this.update()
									},
								}}
							>
								+ New Token
							</button>
						)}
					</div>

					{/* Create Token Form */}
					{showCreateForm && (
						<div
							css={{
								backgroundColor: colors.background,
								borderRadius: radius.md,
								padding: spacing.md,
								marginBottom: spacing.lg,
								border: `1px solid ${colors.border}`,
							}}
						>
							<div css={{ marginBottom: spacing.sm }}>
								<label
									for="new-token-label"
									css={{
										display: 'block',
										fontSize: typography.fontSize.sm,
										fontWeight: typography.fontWeight.medium,
										color: colors.text,
										marginBottom: spacing.xs,
									}}
								>
									Label (optional)
								</label>
								<input
									id="new-token-label"
									type="text"
									value={newTokenLabel}
									placeholder="e.g., iPhone, Podcast App"
									css={{
										width: '100%',
										padding: spacing.sm,
										fontSize: typography.fontSize.sm,
										color: colors.text,
										backgroundColor: colors.surface,
										border: `1px solid ${colors.border}`,
										borderRadius: radius.md,
										outline: 'none',
										'&:focus': { borderColor: colors.primary },
									}}
									on={{
										input: (e) => {
											newTokenLabel = (e.target as HTMLInputElement).value
											this.update()
										},
									}}
								/>
							</div>
							<div css={{ display: 'flex', gap: spacing.sm }}>
								<button
									type="button"
									disabled={createLoading}
									css={{
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
									}}
									on={{ click: createToken }}
								>
									{createLoading ? 'Creating...' : 'Create'}
								</button>
								<button
									type="button"
									css={{
										padding: `${spacing.xs} ${spacing.md}`,
										fontSize: typography.fontSize.sm,
										color: colors.text,
										backgroundColor: 'transparent',
										border: `1px solid ${colors.border}`,
										borderRadius: radius.md,
										cursor: 'pointer',
										transition: `all ${transitions.fast}`,
										'&:hover': { backgroundColor: colors.surface },
									}}
									on={{
										click: () => {
											showCreateForm = false
											newTokenLabel = ''
											this.update()
										},
									}}
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					{/* Active Tokens */}
					{activeTokens.length === 0 ? (
						<div
							css={{
								textAlign: 'center',
								padding: spacing.xl,
								color: colors.textMuted,
							}}
						>
							<p css={{ margin: 0 }}>
								No tokens yet. Create one to share this feed.
							</p>
						</div>
					) : (
						<div
							css={{
								display: 'flex',
								flexDirection: 'column',
								gap: spacing.sm,
							}}
						>
							{activeTokens.map((token) => (
								<TokenCard
									key={token.token}
									token={token}
									isCopied={copiedToken === token.token}
									onCopy={() => copyFeedUrl(token.token)}
									onRevoke={() => revokeToken(token.token)}
									formatDate={formatDate}
									formatRelativeTime={formatRelativeTime}
								/>
							))}
						</div>
					)}

					{/* Revoked Tokens (collapsed) */}
					{revokedTokens.length > 0 && (
						<div css={{ marginTop: spacing.lg }}>
							<p
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									margin: `0 0 ${spacing.sm} 0`,
								}}
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
	return (
		<div
			css={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				padding: spacing['2xl'],
			}}
		>
			<div
				css={{
					width: '40px',
					height: '40px',
					border: `3px solid ${colors.border}`,
					borderTopColor: colors.primary,
					borderRadius: '50%',
					animation: 'spin 1s linear infinite',
					'@keyframes spin': {
						to: { transform: 'rotate(360deg)' },
					},
				}}
			/>
		</div>
	)
}

function ErrorMessage({ message }: { message: string }) {
	return (
		<div
			css={{
				padding: spacing.xl,
				backgroundColor: 'rgba(239, 68, 68, 0.1)',
				borderRadius: radius.md,
				border: '1px solid rgba(239, 68, 68, 0.3)',
			}}
		>
			<p
				css={{
					color: '#ef4444',
					margin: 0,
					fontSize: typography.fontSize.base,
				}}
			>
				Failed to load feed: {message}
			</p>
			<Link
				href="/admin"
				css={{
					display: 'inline-block',
					marginTop: spacing.md,
					color: colors.primary,
					textDecoration: 'none',
					'&:hover': { textDecoration: 'underline' },
				}}
			>
				← Back to feeds
			</Link>
		</div>
	)
}

function InfoItem({
	label,
	value,
	mono,
}: {
	label: string
	value: string
	mono?: boolean
}) {
	return (
		<div>
			<dt
				css={{
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					marginBottom: spacing.xs,
				}}
			>
				{label}
			</dt>
			<dd
				css={{
					fontSize: typography.fontSize.sm,
					color: colors.text,
					margin: 0,
					fontFamily: mono ? 'monospace' : 'inherit',
					wordBreak: mono ? 'break-all' : 'normal',
				}}
			>
				{value}
			</dd>
		</div>
	)
}

function DirectoriesInfo({ directoryPaths }: { directoryPaths: string }) {
	let paths: Array<string> = []
	try {
		paths = JSON.parse(directoryPaths) as Array<string>
	} catch {
		paths = []
	}

	return (
		<div css={{ gridColumn: paths.length > 1 ? '1 / -1' : undefined }}>
			<dt
				css={{
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					marginBottom: spacing.xs,
				}}
			>
				{paths.length === 1 ? 'Directory' : `Directories (${paths.length})`}
			</dt>
			<dd css={{ margin: 0 }}>
				{paths.length === 0 ? (
					<span
						css={{ fontSize: typography.fontSize.sm, color: colors.textMuted }}
					>
						No directories configured
					</span>
				) : paths.length === 1 ? (
					<span
						css={{
							fontSize: typography.fontSize.sm,
							color: colors.text,
							fontFamily: 'monospace',
							wordBreak: 'break-all',
						}}
					>
						{paths[0]}
					</span>
				) : (
					<ul
						css={{
							listStyle: 'none',
							padding: 0,
							margin: 0,
							display: 'flex',
							flexDirection: 'column',
							gap: spacing.xs,
						}}
					>
						{paths.map((path, _index) => (
							<li
								key={path}
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.text,
									fontFamily: 'monospace',
									wordBreak: 'break-all',
									padding: `${spacing.xs} ${spacing.sm}`,
									backgroundColor: colors.background,
									borderRadius: radius.sm,
									border: `1px solid ${colors.border}`,
								}}
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

function TokenCard({
	token,
	isCopied,
	onCopy,
	onRevoke,
	formatDate,
	formatRelativeTime,
}: {
	token: Token
	isCopied: boolean
	onCopy: () => void
	onRevoke: () => void
	formatDate: (ts: number) => string
	formatRelativeTime: (ts: number | null) => string
}) {
	return (
		<div
			css={{
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				padding: spacing.md,
				backgroundColor: colors.background,
				borderRadius: radius.md,
				border: `1px solid ${colors.border}`,
			}}
		>
			<div css={{ flex: 1, minWidth: 0 }}>
				<div
					css={{
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.text,
						marginBottom: spacing.xs,
					}}
				>
					{token.label || 'Unlabeled token'}
				</div>
				<div
					css={{
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						display: 'flex',
						gap: spacing.md,
						flexWrap: 'wrap',
					}}
				>
					<span>Created {formatDate(token.createdAt, 'short')}</span>
					<span>Last used: {formatRelativeTime(token.lastUsedAt)}</span>
				</div>
			</div>
			<div css={{ display: 'flex', gap: spacing.sm }}>
				<button
					type="button"
					css={{
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
					}}
					on={{ click: onCopy }}
				>
					{isCopied ? '✓ Copied' : 'Copy URL'}
				</button>
				<button
					type="button"
					css={{
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
					}}
					on={{ click: onRevoke }}
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

function EditForm({
	form,
	isDirectory,
	isLoading,
	error,
	onNameChange,
	onDescriptionChange,
	onSortFieldsChange,
	onSortOrderChange,
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
	onSortFieldsChange: (value: string) => void
	onSortOrderChange: (value: 'asc' | 'desc') => void
	onDirectoryPathsChange?: (paths: Array<string>) => void
	rootsState: RootsState
	onSave: () => void
	onCancel: () => void
}) {
	return (
		<div>
			<div css={{ marginBottom: spacing.md }}>
				<label
					for="edit-feed-name"
					css={{
						display: 'block',
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.text,
						marginBottom: spacing.xs,
					}}
				>
					Name <span css={{ color: '#ef4444' }}>*</span>
				</label>
				<input
					id="edit-feed-name"
					type="text"
					value={form.name}
					css={inputStyles}
					on={{
						input: (e) => onNameChange((e.target as HTMLInputElement).value),
					}}
				/>
			</div>

			<div css={{ marginBottom: spacing.md }}>
				<label
					for="edit-feed-description"
					css={{
						display: 'block',
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.text,
						marginBottom: spacing.xs,
					}}
				>
					Description
				</label>
				<textarea
					id="edit-feed-description"
					value={form.description}
					rows={3}
					css={{ ...inputStyles, resize: 'vertical', minHeight: '80px' }}
					on={{
						input: (e) =>
							onDescriptionChange((e.target as HTMLTextAreaElement).value),
					}}
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
				css={{
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					gap: spacing.md,
					marginBottom: spacing.md,
				}}
			>
				<div>
					<label
						for="edit-feed-sort-fields"
						css={{
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}}
					>
						Sort By
					</label>
					<select
						id="edit-feed-sort-fields"
						value={form.sortFields}
						css={inputStyles}
						on={{
							change: (e) =>
								onSortFieldsChange((e.target as HTMLSelectElement).value),
						}}
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
						css={{
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.xs,
						}}
					>
						Order
					</label>
					<select
						id="edit-feed-sort-order"
						value={form.sortOrder}
						css={inputStyles}
						on={{
							change: (e) =>
								onSortOrderChange(
									(e.target as HTMLSelectElement).value as 'asc' | 'desc',
								),
						}}
					>
						<option value="desc">Descending</option>
						<option value="asc">Ascending</option>
					</select>
				</div>
			</div>

			{error && (
				<div
					css={{
						padding: spacing.sm,
						backgroundColor: 'rgba(239, 68, 68, 0.1)',
						borderRadius: radius.md,
						border: '1px solid rgba(239, 68, 68, 0.3)',
						marginBottom: spacing.md,
					}}
				>
					<p
						css={{
							color: '#ef4444',
							margin: 0,
							fontSize: typography.fontSize.sm,
						}}
					>
						{error}
					</p>
				</div>
			)}

			<div
				css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}
			>
				<button
					type="button"
					css={{
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
					}}
					on={{ click: onCancel }}
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={isLoading}
					css={{
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
					}}
					on={{ click: onSave }}
				>
					{isLoading ? 'Saving...' : 'Save Changes'}
				</button>
			</div>
		</div>
	)
}

function DirectoryPathsEditor(this: Handle) {
	let browseState: BrowseState = { status: 'idle' }
	let selectedRoot: string | null = null
	let currentPath = ''
	let entries: Array<DirectoryEntry> = []

	const fetchDirectory = async (root: string, path: string) => {
		browseState = { status: 'loading' }
		this.update()

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
		this.update()
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
			this.update()
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
			<div css={{ marginBottom: spacing.md }}>
				<span
					css={{
						display: 'block',
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.text,
						marginBottom: spacing.xs,
					}}
				>
					Directories <span css={{ color: '#ef4444' }}>*</span>
				</span>

				{/* Selected paths list */}
				{paths.length > 0 && (
					<div
						css={{
							marginBottom: spacing.sm,
							padding: spacing.sm,
							backgroundColor: colors.background,
							borderRadius: radius.md,
							border: `1px solid ${colors.border}`,
						}}
					>
						<div
							css={{
								fontSize: typography.fontSize.xs,
								color: colors.textMuted,
								marginBottom: spacing.xs,
							}}
						>
							Selected ({paths.length})
						</div>
						{paths.map((path, index) => (
							<div
								key={path}
								css={{
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									padding: `${spacing.xs} ${spacing.sm}`,
									backgroundColor: colors.surface,
									borderRadius: radius.sm,
									marginBottom: index < paths.length - 1 ? spacing.xs : 0,
								}}
							>
								<span
									css={{
										fontFamily: 'monospace',
										fontSize: typography.fontSize.sm,
										color: colors.primary,
									}}
								>
									{path}
								</span>
								<button
									type="button"
									css={{
										color: '#ef4444',
										backgroundColor: 'transparent',
										border: 'none',
										cursor: 'pointer',
										fontSize: typography.fontSize.sm,
										'&:hover': {
											textDecoration: 'underline',
										},
									}}
									on={{ click: () => removePath(index) }}
								>
									Remove
								</button>
							</div>
						))}
					</div>
				)}

				{/* Media root buttons */}
				{rootsState.status === 'success' && (
					<div css={{ marginBottom: spacing.sm }}>
						<div css={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
							{rootsState.roots.map((root) => (
								<button
									key={root.name}
									type="button"
									css={{
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
									}}
									on={{ click: () => selectRoot(root.name) }}
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
						css={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							overflow: 'hidden',
						}}
					>
						<div
							css={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: spacing.sm,
								backgroundColor: colors.surface,
								borderBottom: `1px solid ${colors.border}`,
							}}
						>
							<span
								css={{
									fontFamily: 'monospace',
									fontSize: typography.fontSize.sm,
									color: colors.primary,
								}}
							>
								{selectedRoot}/{currentPath}
							</span>
							{currentMediaPath && !isPathAdded(currentMediaPath) ? (
								<button
									type="button"
									css={{
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
									}}
									on={{ click: addCurrentDirectory }}
								>
									+ Add This Directory
								</button>
							) : (
								<span
									css={{
										padding: `${spacing.xs} ${spacing.sm}`,
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
									}}
								>
									Added
								</span>
							)}
						</div>

						<div
							css={{
								maxHeight: '200px',
								overflowY: 'auto',
								backgroundColor: colors.background,
							}}
						>
							{browseState.status === 'loading' && (
								<div
									css={{
										padding: spacing.md,
										textAlign: 'center',
										color: colors.textMuted,
									}}
								>
									Loading...
								</div>
							)}

							{browseState.status === 'error' && (
								<div
									css={{
										padding: spacing.md,
										textAlign: 'center',
										color: '#ef4444',
									}}
								>
									{browseState.message}
								</div>
							)}

							{browseState.status === 'success' && (
								<>
									{currentPath && (
										<button
											type="button"
											css={{
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
											}}
											on={{ click: navigateUp }}
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
												css={{
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
												}}
												on={{ click: () => navigateToDir(entry.name) }}
											>
												📁 {entry.name}
											</button>
										))}
									{entries.filter((e) => e.type === 'directory').length ===
										0 && (
										<div
											css={{
												padding: spacing.md,
												textAlign: 'center',
												color: colors.textMuted,
												fontSize: typography.fontSize.sm,
											}}
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

function DeleteConfirmModal({
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
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-confirm-modal-title"
			tabIndex={-1}
			css={{
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
				padding: spacing.lg,
				outline: 'none',
				[mq.mobile]: {
					padding: 0,
				},
			}}
			on={{
				click: (e) => {
					if (e.target === e.currentTarget) onCancel()
				},
				keydown: (e: KeyboardEvent) => {
					if (e.key === 'Escape') onCancel()
				},
			}}
		>
			<div
				css={{
					position: 'relative',
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '400px',
					width: '100%',
					boxShadow: shadows.lg,
					[mq.mobile]: {
						maxWidth: 'none',
						maxHeight: 'none',
						height: '100%',
						borderRadius: 0,
						border: 'none',
						display: 'flex',
						flexDirection: 'column',
					},
				}}
			>
				{/* Close button */}
				<button
					type="button"
					aria-label="Close"
					autofocus
					css={{
						position: 'absolute',
						top: spacing.md,
						right: spacing.md,
						width: '32px',
						height: '32px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: colors.background,
						border: `1px solid ${colors.border}`,
						borderRadius: radius.md,
						cursor: 'pointer',
						color: colors.textMuted,
						fontSize: typography.fontSize.lg,
						transition: `all ${transitions.fast}`,
						'&:hover': {
							backgroundColor: colors.surface,
							color: colors.text,
						},
					}}
					on={{ click: onCancel }}
				>
					×
				</button>

				<h3
					id="delete-confirm-modal-title"
					css={{
						fontSize: typography.fontSize.lg,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: `0 0 ${spacing.md} 0`,
						paddingRight: spacing.xl,
					}}
				>
					Delete Feed
				</h3>

				<p
					css={{
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
						margin: `0 0 ${spacing.md} 0`,
					}}
				>
					Are you sure you want to delete{' '}
					<strong css={{ color: colors.text }}>{feedName}</strong>?
				</p>

				<div
					css={{
						backgroundColor: 'rgba(239, 68, 68, 0.1)',
						borderRadius: radius.md,
						padding: spacing.md,
						marginBottom: spacing.lg,
					}}
				>
					<p
						css={{
							fontSize: typography.fontSize.sm,
							color: '#ef4444',
							margin: 0,
						}}
					>
						This action cannot be undone. The following will be permanently
						deleted:
					</p>
					<ul
						css={{
							fontSize: typography.fontSize.sm,
							color: '#ef4444',
							margin: `${spacing.sm} 0 0 0`,
							paddingLeft: spacing.lg,
						}}
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
				</div>

				<div
					css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}
				>
					<button
						type="button"
						disabled={isLoading}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							backgroundColor: 'transparent',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							cursor: isLoading ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': isLoading
								? {}
								: { backgroundColor: colors.background },
						}}
						on={{ click: onCancel }}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={isLoading}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: '#fff',
							backgroundColor: isLoading ? colors.border : '#ef4444',
							border: 'none',
							borderRadius: radius.md,
							cursor: isLoading ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': isLoading ? {} : { backgroundColor: '#dc2626' },
						}}
						on={{ click: onConfirm }}
					>
						{isLoading ? 'Deleting...' : 'Delete Feed'}
					</button>
				</div>
			</div>
		</div>
	)
}

function AddFilesModal({
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
}) {
	const pathParts = pickerPath ? pickerPath.split('/') : []

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="add-files-modal-title"
			tabIndex={-1}
			css={{
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
				padding: spacing.lg,
				outline: 'none',
				[mq.mobile]: {
					padding: 0,
				},
			}}
			on={{
				click: (e) => {
					if (e.target === e.currentTarget) onCancel()
				},
				keydown: (e: KeyboardEvent) => {
					if (e.key === 'Escape') onCancel()
				},
			}}
		>
			<div
				css={{
					position: 'relative',
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '600px',
					width: '100%',
					maxHeight: '80vh',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: shadows.lg,
					[mq.mobile]: {
						maxWidth: 'none',
						maxHeight: 'none',
						height: '100%',
						borderRadius: 0,
						border: 'none',
					},
				}}
			>
				{/* Close button */}
				<button
					type="button"
					aria-label="Close"
					autofocus
					css={{
						position: 'absolute',
						top: spacing.md,
						right: spacing.md,
						width: '32px',
						height: '32px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: colors.background,
						border: `1px solid ${colors.border}`,
						borderRadius: radius.md,
						cursor: 'pointer',
						color: colors.textMuted,
						fontSize: typography.fontSize.lg,
						transition: `all ${transitions.fast}`,
						zIndex: 1,
						'&:hover': {
							backgroundColor: colors.surface,
							color: colors.text,
						},
					}}
					on={{ click: onCancel }}
				>
					×
				</button>

				<h3
					id="add-files-modal-title"
					css={{
						fontSize: typography.fontSize.lg,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: `0 0 ${spacing.md} 0`,
						paddingRight: spacing.xl,
					}}
				>
					Add Files to Feed
				</h3>

				<p
					css={{
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
						margin: `0 0 ${spacing.lg} 0`,
					}}
				>
					Select media files to add to this feed. Files already in the feed are
					shown but disabled.
				</p>

				{/* File picker */}
				<div
					css={{
						flex: 1,
						minHeight: '250px',
						border: `1px solid ${colors.border}`,
						borderRadius: radius.md,
						overflow: 'hidden',
						display: 'flex',
						flexDirection: 'column',
						marginBottom: spacing.lg,
					}}
				>
					{/* Root selector */}
					{rootsState.status === 'loading' && (
						<div css={{ padding: spacing.lg, textAlign: 'center' }}>
							<span css={{ color: colors.textMuted }}>
								Loading media roots...
							</span>
						</div>
					)}

					{rootsState.status === 'error' && (
						<div css={{ padding: spacing.lg, textAlign: 'center' }}>
							<span css={{ color: '#ef4444' }}>
								Error: {rootsState.message}
							</span>
						</div>
					)}

					{rootsState.status === 'success' && rootsState.roots.length === 0 && (
						<div
							css={{
								padding: spacing.xl,
								textAlign: 'center',
								color: colors.textMuted,
							}}
						>
							<div
								css={{
									width: '48px',
									height: '48px',
									margin: `0 auto ${spacing.md}`,
									borderRadius: radius.md,
									backgroundColor: colors.background,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: '24px',
								}}
							>
								📂
							</div>
							<p
								css={{
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.medium,
									color: colors.text,
									margin: `0 0 ${spacing.sm} 0`,
								}}
							>
								No media files available
							</p>
							<p
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									margin: 0,
									maxWidth: '400px',
									marginLeft: 'auto',
									marginRight: 'auto',
								}}
							>
								To add files to this feed, first add media files to one of your
								configured media path directories. Check your{' '}
								<code
									css={{
										fontSize: typography.fontSize.xs,
										backgroundColor: colors.background,
										padding: `${spacing.xs} ${spacing.xs}`,
										borderRadius: radius.sm,
										fontFamily: 'monospace',
									}}
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
								css={{
									padding: spacing.sm,
									backgroundColor: colors.background,
									borderBottom: `1px solid ${colors.border}`,
									display: 'flex',
									gap: spacing.sm,
									flexWrap: 'wrap',
								}}
							>
								{rootsState.roots.map((root) => (
									<button
										key={root.name}
										type="button"
										css={{
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
										}}
										on={{ click: () => onSelectRoot(root.name) }}
									>
										{root.name}
									</button>
								))}
							</div>

							{/* Path breadcrumb */}
							{pickerRoot && (
								<div
									css={{
										padding: spacing.sm,
										backgroundColor: colors.background,
										borderBottom: `1px solid ${colors.border}`,
										fontSize: typography.fontSize.sm,
										fontFamily: 'monospace',
										color: colors.textMuted,
										display: 'flex',
										alignItems: 'center',
										gap: spacing.xs,
									}}
								>
									<span css={{ color: colors.primary }}>{pickerRoot}</span>
									{pathParts.map((part, i) => (
										<span key={i}>
											<span css={{ color: colors.textMuted }}>/</span>
											<span>{part}</span>
										</span>
									))}
									{!pickerPath && (
										<span css={{ color: colors.textMuted }}>/</span>
									)}
								</div>
							)}

							{/* File listing */}
							<div
								css={{
									flex: 1,
									minHeight: '150px',
									overflowY: 'auto',
									backgroundColor: colors.surface,
								}}
							>
								{!pickerRoot && (
									<div
										css={{
											padding: spacing.lg,
											textAlign: 'center',
											color: colors.textMuted,
										}}
									>
										Select a media root to browse files
									</div>
								)}

								{pickerRoot && browseState.status === 'loading' && (
									<div css={{ padding: spacing.lg, textAlign: 'center' }}>
										<span css={{ color: colors.textMuted }}>Loading...</span>
									</div>
								)}

								{pickerRoot && browseState.status === 'error' && (
									<div css={{ padding: spacing.lg, textAlign: 'center' }}>
										<span css={{ color: '#ef4444' }}>
											{browseState.message}
										</span>
									</div>
								)}

								{pickerRoot && browseState.status === 'success' && (
									<div>
										{pickerPath && (
											<button
												type="button"
												css={fileItemStyles}
												on={{ click: onNavigateUp }}
											>
												<span css={{ marginRight: spacing.sm }}>📁</span>
												<span>..</span>
											</button>
										)}

										{browseState.entries.length === 0 && !pickerPath && (
											<div
												css={{
													padding: spacing.xl,
													textAlign: 'center',
													color: colors.textMuted,
												}}
											>
												<div
													css={{
														width: '40px',
														height: '40px',
														margin: `0 auto ${spacing.sm}`,
														borderRadius: radius.md,
														backgroundColor: colors.background,
														display: 'flex',
														alignItems: 'center',
														justifyContent: 'center',
														fontSize: '20px',
													}}
												>
													📂
												</div>
												<p
													css={{
														fontSize: typography.fontSize.sm,
														fontWeight: typography.fontWeight.medium,
														color: colors.text,
														margin: `0 0 ${spacing.xs} 0`,
													}}
												>
													No files in this directory
												</p>
												<p
													css={{
														fontSize: typography.fontSize.xs,
														color: colors.textMuted,
														margin: 0,
													}}
												>
													Add media files to{' '}
													<code
														css={{
															fontFamily: 'monospace',
															backgroundColor: colors.background,
															padding: `0 ${spacing.xs}`,
															borderRadius: radius.sm,
														}}
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
													css={fileItemStyles}
													on={{ click: () => onNavigateToDir(entry.name) }}
												>
													<span css={{ marginRight: spacing.sm }}>📁</span>
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
														css={{
															...fileItemStyles,
															backgroundColor: selected
																? colors.primarySoft
																: inFeed
																	? 'rgba(128, 128, 128, 0.05)'
																	: 'transparent',
															opacity: inFeed ? 0.5 : 1,
															cursor: inFeed ? 'not-allowed' : 'pointer',
														}}
														on={{
															click: () => {
																if (!inFeed) onToggleFile(entry.name)
															},
														}}
													>
														<span
															css={{
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
															}}
														>
															{(selected || inFeed) && '✓'}
														</span>
														<span css={{ marginRight: spacing.sm }}>📄</span>
														<span>{entry.name}</span>
														{inFeed && (
															<span
																css={{
																	marginLeft: 'auto',
																	fontSize: typography.fontSize.xs,
																	color: colors.textMuted,
																}}
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

				{/* Footer */}
				<div
					css={{
						display: 'flex',
						gap: spacing.sm,
						justifyContent: 'space-between',
						alignItems: 'center',
					}}
				>
					<span
						css={{ fontSize: typography.fontSize.sm, color: colors.textMuted }}
					>
						{selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
					</span>
					<div css={{ display: 'flex', gap: spacing.sm }}>
						<button
							type="button"
							disabled={isLoading}
							css={{
								padding: `${spacing.sm} ${spacing.lg}`,
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.text,
								backgroundColor: 'transparent',
								border: `1px solid ${colors.border}`,
								borderRadius: radius.md,
								cursor: isLoading ? 'not-allowed' : 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover': isLoading
									? {}
									: { backgroundColor: colors.background },
							}}
							on={{ click: onCancel }}
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={isLoading || selectedCount === 0}
							css={{
								padding: `${spacing.sm} ${spacing.lg}`,
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.background,
								backgroundColor:
									isLoading || selectedCount === 0
										? colors.border
										: colors.primary,
								border: 'none',
								borderRadius: radius.md,
								cursor:
									isLoading || selectedCount === 0 ? 'not-allowed' : 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover':
									isLoading || selectedCount === 0
										? {}
										: { backgroundColor: colors.primaryHover },
							}}
							on={{ click: onConfirm }}
						>
							{isLoading
								? 'Adding...'
								: `Add ${selectedCount} File${selectedCount !== 1 ? 's' : ''}`}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
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
