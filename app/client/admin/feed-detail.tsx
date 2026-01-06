import type { Handle } from '@remix-run/component'
import {
	colors,
	radius,
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
	directoryPath: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
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
	path: string
}

type FeedResponse = {
	feed: Feed
	tokens: Array<Token>
	items: Array<MediaItem>
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
 * Format duration in seconds to human-readable format (e.g., "1h 23m" or "45m 12s")
 */
function formatDuration(seconds: number | null): string {
	if (seconds === null || seconds === 0) return '—'

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}h ${minutes}m`
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`
	}
	return `${secs}s`
}

/**
 * Format file size in bytes to human-readable format (e.g., "1.2 GB" or "456 MB")
 */
function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B'

	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	const k = 1024
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	const size = bytes / Math.pow(k, i)

	return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

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

	const getFullPath = (filename: string): string | null => {
		if (rootsState.status !== 'success' || !pickerRoot) return null
		const root = rootsState.roots.find((r) => r.name === pickerRoot)
		if (!root) return null
		const relativePath = pickerPath ? `${pickerPath}/${filename}` : filename
		return `${root.path}/${relativePath}`
	}

	const toggleFileSelection = (filename: string, currentItems: Array<MediaItem>) => {
		const fullPath = getFullPath(filename)
		if (!fullPath) return

		const existingIndex = selectedFilePaths.indexOf(fullPath)
		if (existingIndex >= 0) {
			selectedFilePaths.splice(existingIndex, 1)
		} else {
			// Don't allow selecting files already in the feed
			if (!currentItems.some((item) => item.path === fullPath)) {
				selectedFilePaths.push(fullPath)
			}
		}
		this.update()
	}

	const isFileSelected = (filename: string): boolean => {
		const fullPath = getFullPath(filename)
		return fullPath ? selectedFilePaths.includes(fullPath) : false
	}

	const isFileInFeed = (filename: string, currentItems: Array<MediaItem>): boolean => {
		const fullPath = getFullPath(filename)
		return fullPath ? currentItems.some((item) => item.path === fullPath) : false
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
			console.error('Failed to copy to clipboard')
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
		editForm = {
			name: feed.name,
			description: feed.description,
			sortFields: feed.sortFields,
			sortOrder: feed.sortOrder,
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

	const saveEdit = async () => {
		if (!editForm.name.trim()) {
			editError = 'Name is required'
			this.update()
			return
		}

		editLoading = true
		editError = null
		this.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editForm.name.trim(),
					description: editForm.description.trim(),
					sortFields: editForm.sortFields,
					sortOrder: editForm.sortOrder,
				}),
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

	// Item management functions (curated feeds only)
	const removeItem = async (path: string) => {
		itemActionLoading = true
		this.update()

		try {
			const res = await fetch(`/admin/api/feeds/${feedId}/items`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: [path] }),
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

	const moveItem = async (items: Array<MediaItem>, fromIndex: number, toIndex: number) => {
		if (toIndex < 0 || toIndex >= items.length) return

		itemActionLoading = true
		this.update()

		// Create new order with swapped positions
		const newOrder = items.map((item) => item.path)
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

	const formatDate = (timestamp: number) => {
		return new Date(timestamp * 1000).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	}

	const formatRelativeTime = (timestamp: number | null) => {
		if (!timestamp) return 'Never'
		const now = Date.now() / 1000
		const diff = now - timestamp

		if (diff < 60) return 'Just now'
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
		if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
		return formatDate(timestamp)
	}

	return (renderProps: { params: Record<string, string> }) => {
		// Fetch on first render or if id changes
		if (renderProps.params.id && renderProps.params.id !== feedId) {
			// Use setTimeout to avoid updating during render
			setTimeout(() => fetchFeed(renderProps.params.id), 0)
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
						currentItems={items}
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
					}}
				>
					<Link
						href="/admin"
						css={{
							color: colors.textMuted,
							textDecoration: 'none',
							fontSize: typography.fontSize.sm,
							'&:hover': { color: colors.text },
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
						}}
					>
						{feed.type}
					</span>
					{!isEditing && (
						<div css={{ display: 'flex', gap: spacing.sm }}>
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
										backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
						padding: spacing.lg,
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
							onSave={saveEdit}
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
									<InfoItem
										label="Directory"
										value={(feed as DirectoryFeed).directoryPath}
										mono
									/>
								)}
								<InfoItem
									label="Sort"
									value={`${feed.sortFields} (${feed.sortOrder})`}
								/>
								<InfoItem label="Created" value={formatDate(feed.createdAt)} />
								<InfoItem label="Updated" value={formatDate(feed.updatedAt)} />
							</div>
						</>
					)}
				</div>

				{/* Media Items Section */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: spacing.lg,
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
						<div css={{ overflowX: 'auto' }}>
							<table
								css={{
									width: '100%',
									borderCollapse: 'collapse',
									fontSize: typography.fontSize.sm,
								}}
							>
								<thead>
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
											}}
										>
											Size
										</th>
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
									</tr>
								</thead>
								<tbody>
								{items.map((item, index) => (
									<tr
										key={item.path}
										draggable={isManualSort}
										css={{
											borderBottom: `1px solid ${colors.border}`,
											'&:last-child': { borderBottom: 'none' },
											'&:hover': {
												backgroundColor: colors.background,
											},
											opacity: draggingIndex === index ? 0.5 : 1,
											backgroundColor: dragOverIndex === index ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
											cursor: isManualSort ? 'grab' : 'default',
										}}
										on={isManualSort ? {
											dragstart: () => handleDragStart(index),
											dragover: (e: DragEvent) => handleDragOver(e, index),
											dragleave: handleDragLeave,
											drop: () => handleDrop(items, index),
											dragend: handleDragEnd,
										} : undefined}
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
												<span css={{ fontSize: typography.fontSize.sm }}>⋮⋮</span>
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
												}}
											>
												{formatFileSize(item.sizeBytes)}
											</td>
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
																	color: index === 0 ? colors.border : colors.textMuted,
																	backgroundColor: 'transparent',
																	border: `1px solid ${index === 0 ? colors.border : colors.border}`,
																	borderRadius: radius.sm,
																	cursor: index === 0 ? 'not-allowed' : 'pointer',
																	transition: `all ${transitions.fast}`,
																	lineHeight: 1,
																	'&:hover': index === 0 ? {} : {
																		color: colors.text,
																		borderColor: colors.text,
																	},
																}}
																on={{ click: () => moveItem(items, index, index - 1) }}
															>
																↑
															</button>
															<button
																type="button"
																disabled={index === items.length - 1 || itemActionLoading}
																title="Move down"
																css={{
																	padding: spacing.xs,
																	fontSize: typography.fontSize.sm,
																	color: index === items.length - 1 ? colors.border : colors.textMuted,
																	backgroundColor: 'transparent',
																	border: `1px solid ${index === items.length - 1 ? colors.border : colors.border}`,
																	borderRadius: radius.sm,
																	cursor: index === items.length - 1 ? 'not-allowed' : 'pointer',
																	transition: `all ${transitions.fast}`,
																	lineHeight: 1,
																	'&:hover': index === items.length - 1 ? {} : {
																		color: colors.text,
																		borderColor: colors.text,
																	},
																}}
																on={{ click: () => moveItem(items, index, index + 1) }}
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
															cursor: itemActionLoading ? 'not-allowed' : 'pointer',
															transition: `all ${transitions.fast}`,
															lineHeight: 1,
															'&:hover': itemActionLoading ? {} : {
																backgroundColor: 'rgba(239, 68, 68, 0.1)',
															},
														}}
														on={{ click: () => removeItem(item.path) }}
													>
														×
													</button>
												</div>
											</td>
										)}
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
						padding: spacing.lg,
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
					<span>Created {formatDate(token.createdAt)}</span>
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
								: 'rgba(59, 130, 246, 0.1)',
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
								<option value="filename">Filename</option>
								<option value="date">Date Modified</option>
								<option value="size">File Size</option>
							</>
						) : (
							<>
								<option value="position">Manual Order</option>
								<option value="filename">Filename</option>
								<option value="date">Date Modified</option>
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
						<option value="asc">Ascending</option>
						<option value="desc">Descending</option>
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
					<p css={{ color: '#ef4444', margin: 0, fontSize: typography.fontSize.sm }}>
						{error}
					</p>
				</div>
			)}

			<div css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
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
						'&:hover': isLoading ? {} : { backgroundColor: colors.primaryHover },
					}}
					on={{ click: onSave }}
				>
					{isLoading ? 'Saving...' : 'Save Changes'}
				</button>
			</div>
		</div>
	)
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
			}}
			on={{ click: (e) => e.target === e.currentTarget && onCancel() }}
		>
			<div
				css={{
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '400px',
					width: '100%',
					boxShadow: shadows.lg,
				}}
			>
				<h3
					css={{
						fontSize: typography.fontSize.lg,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: `0 0 ${spacing.md} 0`,
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
						This action cannot be undone. The following will be permanently deleted:
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

				<div css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
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
							'&:hover': isLoading ? {} : { backgroundColor: colors.background },
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
	currentItems,
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
	currentItems: Array<MediaItem>
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
			}}
			on={{ click: (e) => e.target === e.currentTarget && onCancel() }}
		>
			<div
				css={{
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
				}}
			>
				<h3
					css={{
						fontSize: typography.fontSize.lg,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: `0 0 ${spacing.md} 0`,
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
					Select media files to add to this feed. Files already in the feed are shown but disabled.
				</p>

				{/* File picker */}
				<div
					css={{
						flex: 1,
						minHeight: 0,
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
							<span css={{ color: colors.textMuted }}>Loading media roots...</span>
						</div>
					)}

					{rootsState.status === 'error' && (
						<div css={{ padding: spacing.lg, textAlign: 'center' }}>
							<span css={{ color: '#ef4444' }}>Error: {rootsState.message}</span>
						</div>
					)}

					{rootsState.status === 'success' && (
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
												pickerRoot === root.name ? colors.primary : 'transparent',
											color:
												pickerRoot === root.name ? colors.background : colors.text,
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
									{!pickerPath && <span css={{ color: colors.textMuted }}>/</span>}
								</div>
							)}

							{/* File listing */}
							<div
								css={{
									flex: 1,
									minHeight: 0,
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
										<span css={{ color: '#ef4444' }}>{browseState.message}</span>
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
													padding: spacing.lg,
													textAlign: 'center',
													color: colors.textMuted,
												}}
											>
												Empty directory
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
																? 'rgba(59, 130, 246, 0.1)'
																: inFeed
																	? 'rgba(128, 128, 128, 0.05)'
																	: 'transparent',
															opacity: inFeed ? 0.5 : 1,
															cursor: inFeed ? 'not-allowed' : 'pointer',
														}}
														on={{ click: () => !inFeed && onToggleFile(entry.name) }}
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
				<div css={{ display: 'flex', gap: spacing.sm, justifyContent: 'space-between', alignItems: 'center' }}>
					<span css={{ fontSize: typography.fontSize.sm, color: colors.textMuted }}>
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
								'&:hover': isLoading ? {} : { backgroundColor: colors.background },
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
								backgroundColor: isLoading || selectedCount === 0 ? colors.border : colors.primary,
								border: 'none',
								borderRadius: radius.md,
								cursor: isLoading || selectedCount === 0 ? 'not-allowed' : 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover': isLoading || selectedCount === 0 ? {} : { backgroundColor: colors.primaryHover },
							}}
							on={{ click: onConfirm }}
						>
							{isLoading ? 'Adding...' : `Add ${selectedCount} File${selectedCount !== 1 ? 's' : ''}`}
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
