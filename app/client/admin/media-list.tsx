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

type MediaItem = {
	path: string
	rootName: string
	relativePath: string
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	filename: string
	publicationDate: string | null
}

type FeedAssignment = {
	feedId: string
	feedType: 'curated' | 'directory'
}

type CuratedFeed = {
	id: string
	name: string
	imageUrl: string | null
	updatedAt: number
}

type DirectoryFeed = {
	id: string
	name: string
	directoryPaths: Array<string>
	imageUrl: string | null
	updatedAt: number
}

type MediaResponse = {
	items: Array<MediaItem>
}

type AssignmentsResponse = {
	assignments: Record<string, Array<FeedAssignment>>
	curatedFeeds: Array<CuratedFeed>
	directoryFeeds: Array<DirectoryFeed>
}

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| {
			status: 'success'
			media: Array<MediaItem>
			assignments: Record<string, Array<FeedAssignment>>
			curatedFeeds: Array<CuratedFeed>
			directoryFeeds: Array<DirectoryFeed>
	  }

/**
 * Format duration in seconds to human-readable format
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
 * Format file size in bytes to human-readable format
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
 * Check if a media item is within any of the directory paths.
 * Directory paths are in "mediaRoot:relativePath" format.
 */
function isMediaInDirectoryFeed(
	item: MediaItem,
	directoryPaths: Array<string>,
): boolean {
	// Build the media path key in the same format as directory paths
	const mediaPath = `${item.rootName}:${item.relativePath}`

	for (const dirPath of directoryPaths) {
		// Normalize paths for comparison
		const normalizedFile = mediaPath.replace(/\\/g, '/')
		const normalizedDir = dirPath.replace(/\\/g, '/')

		// Check if the file is within this directory
		// Must match exact root name followed by colon to avoid false matches
		// e.g., "audiobooks:file.mp3" should not match "audiobooks-archive"
		if (
			normalizedFile.startsWith(normalizedDir + '/') ||
			normalizedFile === normalizedDir ||
			// For root-level matches, ensure we have the colon separator
			(normalizedFile.startsWith(normalizedDir + ':') &&
				!normalizedDir.includes(':'))
		) {
			return true
		}
	}
	return false
}

/**
 * Get all feeds (curated + directory) that a media item belongs to
 */
function getMediaFeeds(
	item: MediaItem,
	assignments: Record<string, Array<FeedAssignment>>,
	directoryFeeds: Array<DirectoryFeed>,
): Array<{ feedId: string; feedType: 'curated' | 'directory'; name: string }> {
	const feeds: Array<{
		feedId: string
		feedType: 'curated' | 'directory'
		name: string
	}> = []

	// Build the media path key in the same format as assignments
	const mediaPath = `${item.rootName}:${item.relativePath}`

	// Add curated feed assignments
	const curatedAssignments = assignments[mediaPath] ?? []
	for (const assignment of curatedAssignments) {
		feeds.push({
			feedId: assignment.feedId,
			feedType: 'curated',
			name: '', // Will be filled by caller if needed
		})
	}

	// Add directory feed matches
	for (const dirFeed of directoryFeeds) {
		if (isMediaInDirectoryFeed(item, dirFeed.directoryPaths)) {
			feeds.push({
				feedId: dirFeed.id,
				feedType: 'directory',
				name: dirFeed.name,
			})
		}
	}

	return feeds
}

const ITEMS_PER_PAGE = 100

/**
 * MediaList component - displays all media files with search/filter and assignment management
 */
export function MediaList(this: Handle) {
	let state: LoadingState = { status: 'loading' }
	let searchQuery = ''
	let currentPage = 1
	let selectedItem: MediaItem | null = null
	let modalFeedIds: Set<string> = new Set()
	let saving = false

	// Bulk selection state
	let selectedItems: Set<string> = new Set() // Set of "rootName:relativePath" keys
	let showBulkAssignModal = false
	let showBulkUnassignModal = false
	let bulkSelectedFeedIds: Set<string> = new Set() // For bulk assign (multi-select)
	let bulkUnassignFeedId: string | null = null // For bulk unassign (single-select)
	let bulkSaving = false

	// Helper to get the selection key for a media item
	const getItemKey = (item: MediaItem) =>
		`${item.rootName}:${item.relativePath}`

	// Toggle selection for a single item
	const toggleSelection = (item: MediaItem) => {
		const key = getItemKey(item)
		if (selectedItems.has(key)) {
			selectedItems.delete(key)
		} else {
			selectedItems.add(key)
		}
		this.update()
	}

	// Clear all selections
	const clearSelection = () => {
		selectedItems = new Set()
		this.update()
	}

	// Select all filtered items (across all pages)
	const selectAllFiltered = (filteredMedia: Array<MediaItem>) => {
		for (const item of filteredMedia) {
			selectedItems.add(getItemKey(item))
		}
		this.update()
	}

	// Check if all filtered items are selected
	const areAllFilteredItemsSelected = (filteredMedia: Array<MediaItem>) => {
		if (filteredMedia.length === 0) return false
		return filteredMedia.every((item) => selectedItems.has(getItemKey(item)))
	}

	// Check if some (but not all) filtered items are selected
	const areSomeFilteredItemsSelected = (filteredMedia: Array<MediaItem>) => {
		if (filteredMedia.length === 0) return false
		const selectedCount = filteredMedia.filter((item) =>
			selectedItems.has(getItemKey(item)),
		).length
		return selectedCount > 0 && selectedCount < filteredMedia.length
	}

	// Deselect all filtered items
	const deselectAllFiltered = (filteredMedia: Array<MediaItem>) => {
		for (const item of filteredMedia) {
			selectedItems.delete(getItemKey(item))
		}
		this.update()
	}

	// Open bulk assign modal
	const openBulkAssignModal = () => {
		showBulkAssignModal = true
		bulkSelectedFeedIds = new Set()
		this.update()
	}

	// Close bulk assign modal
	const closeBulkAssignModal = () => {
		showBulkAssignModal = false
		bulkSelectedFeedIds = new Set()
		this.update()
	}

	// Open bulk unassign modal
	const openBulkUnassignModal = () => {
		showBulkUnassignModal = true
		bulkUnassignFeedId = null
		this.update()
	}

	// Close bulk unassign modal
	const closeBulkUnassignModal = () => {
		showBulkUnassignModal = false
		bulkUnassignFeedId = null
		this.update()
	}

	// Get feeds that have at least one of the selected items assigned
	const getFeedsWithSelectedItems = () => {
		if (state.status !== 'success') return []
		const feedsWithItems = new Map<
			string,
			{ feed: CuratedFeed; count: number }
		>()

		for (const mediaPath of selectedItems) {
			const assignments = state.assignments[mediaPath] ?? []
			for (const assignment of assignments) {
				if (assignment.feedType === 'curated') {
					const feed = state.curatedFeeds.find(
						(f) => f.id === assignment.feedId,
					)
					if (feed) {
						const existing = feedsWithItems.get(feed.id)
						if (existing) {
							existing.count++
						} else {
							feedsWithItems.set(feed.id, { feed, count: 1 })
						}
					}
				}
			}
		}

		return Array.from(feedsWithItems.values())
	}

	// Save bulk assignments (add to feeds)
	const saveBulkAssignments = async () => {
		if (bulkSelectedFeedIds.size === 0 || state.status !== 'success') return

		bulkSaving = true
		this.update()

		try {
			const res = await fetch('/admin/api/media/assignments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaPaths: [...selectedItems],
					feedIds: [...bulkSelectedFeedIds],
					action: 'add',
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Update local state with new assignments for all selected feeds
			for (const mediaPath of selectedItems) {
				const existing = state.assignments[mediaPath] ?? []
				for (const feedId of bulkSelectedFeedIds) {
					// Only add if not already assigned to this feed
					if (!existing.some((a) => a.feedId === feedId)) {
						existing.push({ feedId, feedType: 'curated' })
					}
				}
				state.assignments[mediaPath] = existing
			}

			closeBulkAssignModal()
			clearSelection()
		} catch (err) {
			console.error('Failed to save bulk assignments:', err)
		} finally {
			bulkSaving = false
			this.update()
		}
	}

	// Save bulk unassignments (remove from feed)
	const saveBulkUnassignments = async () => {
		if (!bulkUnassignFeedId || state.status !== 'success') return

		bulkSaving = true
		this.update()

		try {
			const res = await fetch('/admin/api/media/assignments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaPaths: [...selectedItems],
					feedIds: [bulkUnassignFeedId],
					action: 'remove',
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Update local state by removing assignments
			for (const mediaPath of selectedItems) {
				const existing = state.assignments[mediaPath] ?? []
				state.assignments[mediaPath] = existing.filter(
					(a) => a.feedId !== bulkUnassignFeedId,
				)
			}

			closeBulkUnassignModal()
			clearSelection()
		} catch (err) {
			console.error('Failed to save bulk unassignments:', err)
		} finally {
			bulkSaving = false
			this.update()
		}
	}

	// Fetch media and assignments
	const fetchData = async () => {
		try {
			const [mediaRes, assignmentsRes] = await Promise.all([
				fetch('/admin/api/media', { signal: this.signal }),
				fetch('/admin/api/media/assignments', { signal: this.signal }),
			])

			if (!mediaRes.ok) throw new Error(`Media: HTTP ${mediaRes.status}`)
			if (!assignmentsRes.ok)
				throw new Error(`Assignments: HTTP ${assignmentsRes.status}`)

			const mediaData = (await mediaRes.json()) as MediaResponse
			const assignmentsData =
				(await assignmentsRes.json()) as AssignmentsResponse

			state = {
				status: 'success',
				media: mediaData.items,
				assignments: assignmentsData.assignments,
				curatedFeeds: assignmentsData.curatedFeeds,
				directoryFeeds: assignmentsData.directoryFeeds,
			}
			this.update()
		} catch (err) {
			if (this.signal.aborted) return
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			this.update()
		}
	}

	fetchData()

	const openModal = (item: MediaItem) => {
		if (state.status !== 'success') return
		selectedItem = item

		// Initialize modal with current curated feed assignments
		// Use the same key format as the API: "mediaRoot:relativePath"
		const mediaPath = `${item.rootName}:${item.relativePath}`
		const currentAssignments = state.assignments[mediaPath] ?? []
		modalFeedIds = new Set(
			currentAssignments
				.filter((a) => a.feedType === 'curated')
				.map((a) => a.feedId),
		)
		this.update()
	}

	const closeModal = () => {
		selectedItem = null
		modalFeedIds = new Set()
		this.update()
	}

	const toggleFeed = (feedId: string) => {
		if (modalFeedIds.has(feedId)) {
			modalFeedIds.delete(feedId)
		} else {
			modalFeedIds.add(feedId)
		}
		this.update()
	}

	const saveAssignments = async () => {
		if (!selectedItem || state.status !== 'success') return

		saving = true
		this.update()

		try {
			// Build the media path in the format expected by the API: "mediaRoot:relativePath"
			const mediaPath = `${selectedItem.rootName}:${selectedItem.relativePath}`

			const res = await fetch('/admin/api/media/assignments', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaPath,
					feedIds: [...modalFeedIds],
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Update local state with new assignments using the same key format
			const newAssignments = [...modalFeedIds].map((feedId) => ({
				feedId,
				feedType: 'curated' as const,
			}))
			state.assignments[mediaPath] = newAssignments

			closeModal()
		} catch (err) {
			console.error('Failed to save assignments:', err)
		} finally {
			saving = false
			this.update()
		}
	}

	const getArtworkUrl = (item: MediaItem) => {
		return `/admin/api/artwork/${encodeURIComponent(item.rootName)}/${encodeURIComponent(item.relativePath)}`
	}

	return () => {
		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		if (state.status === 'error') {
			return <ErrorMessage message={state.message} />
		}

		const { media, assignments, curatedFeeds, directoryFeeds } = state

		// Filter media by search query
		const filteredMedia = searchQuery.trim()
			? media.filter(
					(item) =>
						item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
						(item.author?.toLowerCase().includes(searchQuery.toLowerCase()) ??
							false) ||
						item.filename.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: media

		// Paginate filtered results
		const totalPages = Math.ceil(filteredMedia.length / ITEMS_PER_PAGE)
		const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
		const paginatedMedia = filteredMedia.slice(
			startIndex,
			startIndex + ITEMS_PER_PAGE,
		)
		const startItem = filteredMedia.length > 0 ? startIndex + 1 : 0
		const endItem = Math.min(startIndex + ITEMS_PER_PAGE, filteredMedia.length)

		return (
			<div>
				{/* Modal */}
				{selectedItem && (
					<ManageAccessModal
						item={selectedItem}
						curatedFeeds={curatedFeeds}
						directoryFeeds={directoryFeeds}
						selectedFeedIds={modalFeedIds}
						saving={saving}
						getArtworkUrl={getArtworkUrl}
						onToggle={toggleFeed}
						onSave={saveAssignments}
						onCancel={closeModal}
					/>
				)}

				{/* Header */}
				<div
					css={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						marginBottom: spacing.xl,
						flexWrap: 'wrap',
						gap: spacing.md,
					}}
				>
					<div>
						<h2
							css={{
								fontSize: typography.fontSize.xl,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
							}}
						>
							Media Library
						</h2>
						<p
							css={{
								fontSize: typography.fontSize.sm,
								color: colors.textMuted,
								margin: `${spacing.xs} 0 0 0`,
							}}
						>
							{filteredMedia.length === media.length
								? `${media.length} items`
								: `Showing ${filteredMedia.length} of ${media.length} items`}
							{filteredMedia.length > 0 &&
								` · ${startItem}–${endItem} on this page`}
							{' · Click to manage feed access'}
						</p>
					</div>
					<Link
						href="/admin"
						css={{
							color: colors.textMuted,
							textDecoration: 'none',
							fontSize: typography.fontSize.sm,
							'&:hover': { color: colors.text },
						}}
					>
						← Back to Feeds
					</Link>
				</div>

				{/* Search */}
				<div
					css={{
						marginBottom: spacing.lg,
					}}
				>
					<input
						type="text"
						placeholder="Search by title, author, or filename..."
						value={searchQuery}
						css={{
							width: '100%',
							maxWidth: '400px',
							padding: spacing.sm,
							fontSize: typography.fontSize.sm,
							color: colors.text,
							backgroundColor: colors.surface,
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
						}}
						on={{
							input: (e) => {
								searchQuery = (e.target as HTMLInputElement).value
								currentPage = 1 // Reset to first page on search
								this.update()
							},
						}}
					/>
				</div>

				{/* Media Table */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						boxShadow: shadows.sm,
						overflow: 'hidden',
					}}
				>
					{paginatedMedia.length === 0 ? (
						<div
							css={{
								textAlign: 'center',
								padding: spacing['2xl'],
								color: colors.textMuted,
							}}
						>
							{searchQuery
								? 'No media matches your search.'
								: 'No media files found.'}
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
											backgroundColor: colors.background,
										}}
									>
										<th
											css={{
												width: '48px',
												padding: spacing.sm,
												textAlign: 'center',
											}}
										>
											<Checkbox
												checked={areAllFilteredItemsSelected(filteredMedia)}
												indeterminate={areSomeFilteredItemsSelected(
													filteredMedia,
												)}
												onChange={() => {
													if (areAllFilteredItemsSelected(filteredMedia)) {
														deselectAllFiltered(filteredMedia)
													} else {
														selectAllFiltered(filteredMedia)
													}
												}}
												title="Select all matching items"
											/>
										</th>
										<th
											css={{
												width: '60px',
												padding: spacing.sm,
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
										<th
											css={{
												textAlign: 'center',
												padding: `${spacing.sm} ${spacing.md}`,
												color: colors.textMuted,
												fontWeight: typography.fontWeight.medium,
												fontSize: typography.fontSize.xs,
												textTransform: 'uppercase',
												letterSpacing: '0.05em',
												width: '100px',
											}}
										>
											Feeds
										</th>
										<th
											css={{
												textAlign: 'center',
												padding: `${spacing.sm} ${spacing.md}`,
												color: colors.textMuted,
												fontWeight: typography.fontWeight.medium,
												fontSize: typography.fontSize.xs,
												textTransform: 'uppercase',
												letterSpacing: '0.05em',
												width: '80px',
											}}
										>
											Actions
										</th>
									</tr>
								</thead>
								<tbody>
									{paginatedMedia.map((item) => {
										const feeds = getMediaFeeds(
											item,
											assignments,
											directoryFeeds,
										)
										const feedCount = feeds.length
										const isSelected = selectedItems.has(getItemKey(item))

										return (
											// biome-ignore lint/a11y/useSemanticElements: Using role="button" on tr for accessible clickable table rows
											<tr
												key={item.path}
												tabIndex={0}
												role="button"
												css={{
													borderBottom: `1px solid ${colors.border}`,
													'&:last-child': { borderBottom: 'none' },
													cursor: 'pointer',
													transition: `background-color ${transitions.fast}`,
													backgroundColor: isSelected
														? 'rgba(59, 130, 246, 0.08)'
														: 'transparent',
													'&:hover, &:focus': {
														backgroundColor: isSelected
															? 'rgba(59, 130, 246, 0.12)'
															: colors.background,
														outline: 'none',
													},
												}}
												on={{
													click: () => openModal(item),
													keydown: (e: KeyboardEvent) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault()
															openModal(item)
														}
													},
												}}
											>
												<td
													css={{
														padding: spacing.sm,
														textAlign: 'center',
														width: '48px',
													}}
													on={{
														click: (e: MouseEvent) => {
															e.stopPropagation()
															toggleSelection(item)
														},
													}}
												>
													<Checkbox
														checked={isSelected}
														onChange={() => toggleSelection(item)}
													/>
												</td>
												<td css={{ padding: spacing.sm, textAlign: 'center' }}>
													<img
														src={getArtworkUrl(item)}
														alt=""
														loading="lazy"
														css={{
															width: '40px',
															height: '40px',
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
												<td
													css={{
														padding: `${spacing.sm} ${spacing.md}`,
														textAlign: 'center',
													}}
												>
													{feedCount > 0 ? (
														<span
															css={{
																display: 'inline-block',
																padding: `${spacing.xs} ${spacing.sm}`,
																fontSize: typography.fontSize.xs,
																fontWeight: typography.fontWeight.medium,
																color: colors.primary,
																backgroundColor: 'rgba(59, 130, 246, 0.1)',
																borderRadius: radius.sm,
															}}
														>
															{feedCount} feed{feedCount !== 1 ? 's' : ''}
														</span>
													) : (
														<span
															css={{
																fontSize: typography.fontSize.xs,
																color: colors.textMuted,
															}}
														>
															None
														</span>
													)}
												</td>
												<td
													css={{
														padding: `${spacing.sm} ${spacing.md}`,
														textAlign: 'center',
													}}
												>
													<Link
														href={`/admin/media/${encodeURIComponent(item.rootName)}/${encodeURIComponent(item.relativePath)}`}
														css={{
															padding: `${spacing.xs} ${spacing.sm}`,
															fontSize: typography.fontSize.xs,
															fontWeight: typography.fontWeight.medium,
															color: colors.primary,
															textDecoration: 'none',
															border: `1px solid ${colors.primary}`,
															borderRadius: radius.sm,
															'&:hover': {
																backgroundColor: 'rgba(59, 130, 246, 0.1)',
															},
														}}
														on={{
															click: (e: MouseEvent) => e.stopPropagation(),
														}}
													>
														View
													</Link>
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Pagination */}
				{totalPages > 1 && (
					<Pagination
						currentPage={currentPage}
						totalPages={totalPages}
						onPageChange={(page) => {
							currentPage = page
							this.update()
						}}
					/>
				)}

				{/* Floating Action Bar for Bulk Selection */}
				{selectedItems.size > 0 && (
					<FloatingActionBar
						selectedCount={selectedItems.size}
						filteredCount={filteredMedia.length}
						allFilteredSelected={filteredMedia.every((item) =>
							selectedItems.has(getItemKey(item)),
						)}
						feedsWithSelectedItems={getFeedsWithSelectedItems()}
						onSelectAllFiltered={() => selectAllFiltered(filteredMedia)}
						onClearSelection={clearSelection}
						onAssign={openBulkAssignModal}
						onUnassign={openBulkUnassignModal}
					/>
				)}

				{/* Bulk Assign Modal */}
				{showBulkAssignModal && (
					<BulkAssignModal
						selectedCount={selectedItems.size}
						curatedFeeds={curatedFeeds}
						selectedFeedIds={bulkSelectedFeedIds}
						saving={bulkSaving}
						onToggleFeed={(feedId) => {
							if (bulkSelectedFeedIds.has(feedId)) {
								bulkSelectedFeedIds.delete(feedId)
							} else {
								bulkSelectedFeedIds.add(feedId)
							}
							this.update()
						}}
						onSave={saveBulkAssignments}
						onCancel={closeBulkAssignModal}
					/>
				)}

				{/* Bulk Unassign Modal */}
				{showBulkUnassignModal && (
					<BulkUnassignModal
						selectedCount={selectedItems.size}
						feedsWithItems={getFeedsWithSelectedItems()}
						selectedFeedId={bulkUnassignFeedId}
						saving={bulkSaving}
						onSelectFeed={(feedId) => {
							bulkUnassignFeedId = feedId
							this.update()
						}}
						onSave={saveBulkUnassignments}
						onCancel={closeBulkUnassignModal}
					/>
				)}
			</div>
		)
	}
}

function Pagination({
	currentPage,
	totalPages,
	onPageChange,
}: {
	currentPage: number
	totalPages: number
	onPageChange: (page: number) => void
}) {
	// Generate page numbers to display
	const getPageNumbers = () => {
		const pages: Array<number | 'ellipsis'> = []
		const showEllipsis = totalPages > 7

		if (!showEllipsis) {
			for (let i = 1; i <= totalPages; i++) {
				pages.push(i)
			}
		} else {
			pages.push(1)

			if (currentPage > 3) {
				pages.push('ellipsis')
			}

			const start = Math.max(2, currentPage - 1)
			const end = Math.min(totalPages - 1, currentPage + 1)

			for (let i = start; i <= end; i++) {
				pages.push(i)
			}

			if (currentPage < totalPages - 2) {
				pages.push('ellipsis')
			}

			pages.push(totalPages)
		}

		return pages
	}

	const pageNumbers = getPageNumbers()

	return (
		<div
			css={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				gap: spacing.sm,
				marginTop: spacing.xl,
				flexWrap: 'wrap',
			}}
		>
			<button
				type="button"
				disabled={currentPage === 1}
				css={{
					padding: `${spacing.sm} ${spacing.md}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: currentPage === 1 ? colors.textMuted : colors.text,
					backgroundColor: colors.surface,
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover':
						currentPage === 1 ? {} : { backgroundColor: colors.background },
				}}
				on={{ click: () => onPageChange(currentPage - 1) }}
			>
				← Previous
			</button>

			<div css={{ display: 'flex', gap: spacing.xs }}>
				{pageNumbers.map((page, index) =>
					page === 'ellipsis' ? (
						<span
							key={`ellipsis-${index}`}
							css={{
								padding: `${spacing.sm} ${spacing.sm}`,
								color: colors.textMuted,
							}}
						>
							…
						</span>
					) : (
						<button
							key={page}
							type="button"
							css={{
								minWidth: '40px',
								padding: spacing.sm,
								fontSize: typography.fontSize.sm,
								fontWeight:
									page === currentPage
										? typography.fontWeight.semibold
										: typography.fontWeight.medium,
								color: page === currentPage ? colors.background : colors.text,
								backgroundColor:
									page === currentPage ? colors.primary : colors.surface,
								border: `1px solid ${page === currentPage ? colors.primary : colors.border}`,
								borderRadius: radius.md,
								cursor: 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover':
									page === currentPage
										? {}
										: { backgroundColor: colors.background },
							}}
							on={{ click: () => onPageChange(page) }}
						>
							{page}
						</button>
					),
				)}
			</div>

			<button
				type="button"
				disabled={currentPage === totalPages}
				css={{
					padding: `${spacing.sm} ${spacing.md}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: currentPage === totalPages ? colors.textMuted : colors.text,
					backgroundColor: colors.surface,
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover':
						currentPage === totalPages
							? {}
							: { backgroundColor: colors.background },
				}}
				on={{ click: () => onPageChange(currentPage + 1) }}
			>
				Next →
			</button>
		</div>
	)
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
				Failed to load media: {message}
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

function ManageAccessModal({
	item,
	curatedFeeds,
	directoryFeeds,
	selectedFeedIds,
	saving,
	getArtworkUrl,
	onToggle,
	onSave,
	onCancel,
}: {
	item: MediaItem
	curatedFeeds: Array<CuratedFeed>
	directoryFeeds: Array<DirectoryFeed>
	selectedFeedIds: Set<string>
	saving: boolean
	getArtworkUrl: (item: MediaItem) => string
	onToggle: (feedId: string) => void
	onSave: () => void
	onCancel: () => void
}) {
	// Find directory feeds that contain this file
	const matchingDirectoryFeeds = directoryFeeds.filter((feed) =>
		isMediaInDirectoryFeed(item, feed.directoryPaths),
	)

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
			on={{
				click: (e) => {
					if (e.target === e.currentTarget) onCancel()
				},
			}}
		>
			<div
				css={{
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '480px',
					width: '100%',
					maxHeight: '80vh',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: shadows.lg,
				}}
			>
				{/* Header with media info */}
				<div
					css={{
						display: 'flex',
						gap: spacing.md,
						marginBottom: spacing.lg,
						paddingBottom: spacing.lg,
						borderBottom: `1px solid ${colors.border}`,
					}}
				>
					<img
						src={getArtworkUrl(item)}
						alt=""
						css={{
							width: '64px',
							height: '64px',
							borderRadius: radius.md,
							objectFit: 'cover',
							backgroundColor: colors.background,
							flexShrink: 0,
						}}
					/>
					<div css={{ minWidth: 0 }}>
						<h3
							css={{
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
							title={item.title}
						>
							{item.title}
						</h3>
						{item.author && (
							<p
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									margin: `${spacing.xs} 0 0 0`,
								}}
							>
								{item.author}
							</p>
						)}
					</div>
				</div>

				{/* Feeds list */}
				<div
					css={{
						flex: 1,
						minHeight: '150px',
						overflowY: 'auto',
						marginBottom: spacing.lg,
					}}
				>
					{/* Curated feeds with toggles */}
					{curatedFeeds.length > 0 && (
						<div css={{ marginBottom: spacing.lg }}>
							<h4
								css={{
									fontSize: typography.fontSize.xs,
									fontWeight: typography.fontWeight.medium,
									color: colors.textMuted,
									textTransform: 'uppercase',
									letterSpacing: '0.05em',
									margin: `0 0 ${spacing.sm} 0`,
								}}
							>
								Curated Feeds
							</h4>
							<div
								css={{
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}}
							>
								{curatedFeeds.map((feed) => (
									<FeedToggleRow
										key={feed.id}
										feedId={feed.id}
										name={feed.name}
										updatedAt={feed.updatedAt}
										isEnabled={selectedFeedIds.has(feed.id)}
										onToggle={() => onToggle(feed.id)}
									/>
								))}
							</div>
						</div>
					)}

					{/* Directory feeds (read-only) */}
					{matchingDirectoryFeeds.length > 0 && (
						<div>
							<h4
								css={{
									fontSize: typography.fontSize.xs,
									fontWeight: typography.fontWeight.medium,
									color: colors.textMuted,
									textTransform: 'uppercase',
									letterSpacing: '0.05em',
									margin: `0 0 ${spacing.sm} 0`,
								}}
							>
								Directory Feeds
							</h4>
							<div
								css={{
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}}
							>
								{matchingDirectoryFeeds.map((feed) => (
									<div
										key={feed.id}
										css={{
											display: 'flex',
											alignItems: 'center',
											gap: spacing.md,
											padding: spacing.sm,
											backgroundColor: colors.background,
											borderRadius: radius.md,
											opacity: 0.7,
										}}
									>
										<img
											src={`/admin/api/feeds/${feed.id}/artwork?t=${feed.updatedAt}`}
											alt=""
											css={{
												width: '32px',
												height: '32px',
												borderRadius: radius.sm,
												objectFit: 'cover',
											}}
										/>
										<span
											css={{
												flex: 1,
												fontSize: typography.fontSize.sm,
												color: colors.text,
											}}
										>
											{feed.name}
										</span>
										<span
											css={{
												fontSize: typography.fontSize.xs,
												color: colors.textMuted,
												fontStyle: 'italic',
											}}
										>
											via directory
										</span>
									</div>
								))}
							</div>
						</div>
					)}

					{curatedFeeds.length === 0 && matchingDirectoryFeeds.length === 0 && (
						<p
							css={{
								textAlign: 'center',
								color: colors.textMuted,
								fontSize: typography.fontSize.sm,
							}}
						>
							No feeds available.
						</p>
					)}
				</div>

				{/* Footer buttons */}
				<div
					css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}
				>
					<button
						type="button"
						disabled={saving}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							backgroundColor: 'transparent',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							cursor: saving ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': saving ? {} : { backgroundColor: colors.background },
						}}
						on={{ click: onCancel }}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={saving}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.background,
							backgroundColor: saving ? colors.border : colors.primary,
							border: 'none',
							borderRadius: radius.md,
							cursor: saving ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': saving ? {} : { backgroundColor: colors.primaryHover },
						}}
						on={{ click: onSave }}
					>
						{saving ? 'Saving...' : 'Done'}
					</button>
				</div>
			</div>
		</div>
	)
}

function FeedToggleRow({
	feedId,
	name,
	updatedAt,
	isEnabled,
	onToggle,
}: {
	feedId: string
	name: string
	updatedAt: number
	isEnabled: boolean
	onToggle: () => void
}) {
	return (
		<div
			css={{
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				padding: spacing.sm,
				backgroundColor: colors.background,
				borderRadius: radius.md,
			}}
		>
			<img
				src={`/admin/api/feeds/${feedId}/artwork?t=${updatedAt}`}
				alt=""
				css={{
					width: '32px',
					height: '32px',
					borderRadius: radius.sm,
					objectFit: 'cover',
				}}
			/>
			<span
				css={{
					flex: 1,
					fontSize: typography.fontSize.sm,
					color: colors.text,
				}}
			>
				{name}
			</span>
			<ToggleSwitch enabled={isEnabled} onToggle={onToggle} />
		</div>
	)
}

function ToggleSwitch({
	enabled,
	onToggle,
}: {
	enabled: boolean
	onToggle: () => void
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={enabled}
			css={{
				width: '44px',
				height: '24px',
				borderRadius: '12px',
				border: 'none',
				backgroundColor: enabled ? colors.primary : colors.border,
				cursor: 'pointer',
				padding: '2px',
				transition: `background-color ${transitions.fast}`,
				display: 'flex',
				alignItems: 'center',
				'&:focus': {
					outline: `2px solid ${colors.primary}`,
					outlineOffset: '2px',
				},
			}}
			on={{ click: onToggle }}
		>
			<div
				css={{
					width: '20px',
					height: '20px',
					borderRadius: '50%',
					backgroundColor: '#fff',
					boxShadow: shadows.sm,
					transition: `transform ${transitions.fast}`,
					transform: enabled ? 'translateX(20px)' : 'translateX(0)',
				}}
			/>
		</button>
	)
}

function Checkbox({
	checked,
	indeterminate,
	onChange,
	title,
}: {
	checked: boolean
	indeterminate?: boolean
	onChange: () => void
	title?: string
}) {
	return (
		<label
			css={{
				width: '18px',
				height: '18px',
				borderRadius: radius.sm,
				border: `2px solid ${checked || indeterminate ? colors.primary : colors.border}`,
				backgroundColor:
					checked || indeterminate ? colors.primary : 'transparent',
				cursor: 'pointer',
				padding: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				transition: `all ${transitions.fast}`,
				position: 'relative',
				'&:hover': {
					borderColor: colors.primary,
				},
				'&:focus-within': {
					outline: `2px solid ${colors.primary}`,
					outlineOffset: '2px',
				},
			}}
			title={title}
			on={{
				click: (e: MouseEvent) => {
					e.stopPropagation()
				},
			}}
		>
			<input
				type="checkbox"
				checked={checked}
				aria-label={title ?? 'Select item'}
				css={{
					position: 'absolute',
					width: '1px',
					height: '1px',
					padding: 0,
					margin: '-1px',
					overflow: 'hidden',
					clip: 'rect(0, 0, 0, 0)',
					whiteSpace: 'nowrap',
					border: 0,
				}}
				on={{
					change: () => onChange(),
					click: (e: MouseEvent) => e.stopPropagation(),
				}}
			/>
			{checked && (
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<path
						d="M2 6L5 9L10 3"
						stroke="white"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			)}
			{indeterminate && !checked && (
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<path
						d="M2 6H10"
						stroke="white"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			)}
		</label>
	)
}

function FloatingActionBar({
	selectedCount,
	filteredCount,
	allFilteredSelected,
	feedsWithSelectedItems,
	onSelectAllFiltered,
	onClearSelection,
	onAssign,
	onUnassign,
}: {
	selectedCount: number
	filteredCount: number
	allFilteredSelected: boolean
	feedsWithSelectedItems: Array<{ feed: CuratedFeed; count: number }>
	onSelectAllFiltered: () => void
	onClearSelection: () => void
	onAssign: () => void
	onUnassign: () => void
}) {
	const hasAssignedItems = feedsWithSelectedItems.length > 0

	return (
		<div
			css={{
				position: 'fixed',
				bottom: spacing.xl,
				left: '50%',
				transform: 'translateX(-50%)',
				backgroundColor: colors.surface,
				border: `1px solid ${colors.border}`,
				borderRadius: radius.lg,
				boxShadow: shadows.lg,
				padding: `${spacing.sm} ${spacing.lg}`,
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				zIndex: 100,
			}}
		>
			<span
				css={{
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.text,
					whiteSpace: 'nowrap',
				}}
			>
				{selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
			</span>

			{!allFilteredSelected && filteredCount > selectedCount && (
				<button
					type="button"
					css={{
						padding: `${spacing.xs} ${spacing.sm}`,
						fontSize: typography.fontSize.sm,
						color: colors.primary,
						backgroundColor: 'transparent',
						border: 'none',
						cursor: 'pointer',
						textDecoration: 'underline',
						'&:hover': {
							color: colors.primaryHover,
						},
					}}
					on={{ click: onSelectAllFiltered }}
				>
					Select all {filteredCount}
				</button>
			)}

			<div
				css={{
					width: '1px',
					height: '24px',
					backgroundColor: colors.border,
				}}
			/>

			<button
				type="button"
				css={{
					padding: `${spacing.sm} ${spacing.md}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.background,
					backgroundColor: colors.primary,
					border: 'none',
					borderRadius: radius.md,
					cursor: 'pointer',
					transition: `background-color ${transitions.fast}`,
					'&:hover': {
						backgroundColor: colors.primaryHover,
					},
				}}
				on={{ click: onAssign }}
			>
				Assign to Feed
			</button>

			{hasAssignedItems && (
				<button
					type="button"
					css={{
						padding: `${spacing.sm} ${spacing.md}`,
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.error,
						backgroundColor: 'transparent',
						border: `1px solid ${colors.error}`,
						borderRadius: radius.md,
						cursor: 'pointer',
						transition: `all ${transitions.fast}`,
						'&:hover': {
							backgroundColor: 'rgba(239, 68, 68, 0.1)',
						},
					}}
					on={{ click: onUnassign }}
				>
					Remove from Feed
				</button>
			)}

			<button
				type="button"
				css={{
					padding: `${spacing.sm} ${spacing.md}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.textMuted,
					backgroundColor: 'transparent',
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					cursor: 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover': {
						color: colors.text,
						backgroundColor: colors.background,
					},
				}}
				on={{ click: onClearSelection }}
			>
				Clear
			</button>
		</div>
	)
}

function BulkAssignModal({
	selectedCount,
	curatedFeeds,
	selectedFeedIds,
	saving,
	onToggleFeed,
	onSave,
	onCancel,
}: {
	selectedCount: number
	curatedFeeds: Array<CuratedFeed>
	selectedFeedIds: Set<string>
	saving: boolean
	onToggleFeed: (feedId: string) => void
	onSave: () => void
	onCancel: () => void
}) {
	const feedCount = selectedFeedIds.size
	const noFeedsSelected = feedCount === 0

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
			on={{
				click: (e) => {
					if (e.target === e.currentTarget) onCancel()
				},
			}}
		>
			<div
				css={{
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '420px',
					width: '100%',
					maxHeight: '80vh',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: shadows.lg,
				}}
			>
				{/* Header */}
				<div
					css={{
						marginBottom: spacing.lg,
						paddingBottom: spacing.lg,
						borderBottom: `1px solid ${colors.border}`,
					}}
				>
					<h3
						css={{
							fontSize: typography.fontSize.lg,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
						}}
					>
						Assign to Feeds
					</h3>
					<p
						css={{
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
							margin: `${spacing.xs} 0 0 0`,
						}}
					>
						Add {selectedCount} item{selectedCount !== 1 ? 's' : ''} to curated
						feeds
					</p>
				</div>

				{/* Feed list */}
				<div
					css={{
						flex: 1,
						minHeight: '150px',
						maxHeight: '300px',
						overflowY: 'auto',
						marginBottom: spacing.lg,
					}}
				>
					{curatedFeeds.length > 0 ? (
						<div
							css={{
								display: 'flex',
								flexDirection: 'column',
								gap: spacing.sm,
							}}
						>
							{curatedFeeds.map((feed) => (
								<FeedCheckboxRow
									key={feed.id}
									feedId={feed.id}
									name={feed.name}
									updatedAt={feed.updatedAt}
									isSelected={selectedFeedIds.has(feed.id)}
									onToggle={() => onToggleFeed(feed.id)}
								/>
							))}
						</div>
					) : (
						<p
							css={{
								textAlign: 'center',
								color: colors.textMuted,
								fontSize: typography.fontSize.sm,
							}}
						>
							No curated feeds available. Create a feed first.
						</p>
					)}
				</div>

				{/* Footer buttons */}
				<div
					css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}
				>
					<button
						type="button"
						disabled={saving}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							backgroundColor: 'transparent',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							cursor: saving ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': saving ? {} : { backgroundColor: colors.background },
						}}
						on={{ click: onCancel }}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={saving || noFeedsSelected}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.background,
							backgroundColor:
								saving || noFeedsSelected ? colors.border : colors.primary,
							border: 'none',
							borderRadius: radius.md,
							cursor: saving || noFeedsSelected ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover':
								saving || noFeedsSelected
									? {}
									: { backgroundColor: colors.primaryHover },
						}}
						on={{ click: onSave }}
					>
						{saving
							? 'Assigning...'
							: `Assign ${selectedCount} item${selectedCount !== 1 ? 's' : ''} to ${feedCount} feed${feedCount !== 1 ? 's' : ''}`}
					</button>
				</div>
			</div>
		</div>
	)
}

function BulkUnassignModal({
	selectedCount,
	feedsWithItems,
	selectedFeedId,
	saving,
	onSelectFeed,
	onSave,
	onCancel,
}: {
	selectedCount: number
	feedsWithItems: Array<{ feed: CuratedFeed; count: number }>
	selectedFeedId: string | null
	saving: boolean
	onSelectFeed: (feedId: string) => void
	onSave: () => void
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
			on={{
				click: (e) => {
					if (e.target === e.currentTarget) onCancel()
				},
			}}
		>
			<div
				css={{
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.xl,
					maxWidth: '420px',
					width: '100%',
					maxHeight: '80vh',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: shadows.lg,
				}}
			>
				{/* Header */}
				<div
					css={{
						marginBottom: spacing.lg,
						paddingBottom: spacing.lg,
						borderBottom: `1px solid ${colors.border}`,
					}}
				>
					<h3
						css={{
							fontSize: typography.fontSize.lg,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
						}}
					>
						Remove from Feed
					</h3>
					<p
						css={{
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
							margin: `${spacing.xs} 0 0 0`,
						}}
					>
						Remove selected items from a curated feed
					</p>
				</div>

				{/* Feed list */}
				<div
					css={{
						flex: 1,
						minHeight: '150px',
						maxHeight: '300px',
						overflowY: 'auto',
						marginBottom: spacing.lg,
					}}
				>
					{feedsWithItems.length > 0 ? (
						<div
							css={{
								display: 'flex',
								flexDirection: 'column',
								gap: spacing.sm,
							}}
						>
							{feedsWithItems.map(({ feed, count }) => (
								<FeedRadioRowWithCount
									key={feed.id}
									feedId={feed.id}
									name={feed.name}
									updatedAt={feed.updatedAt}
									itemCount={count}
									totalSelected={selectedCount}
									isSelected={selectedFeedId === feed.id}
									onSelect={() => onSelectFeed(feed.id)}
								/>
							))}
						</div>
					) : (
						<p
							css={{
								textAlign: 'center',
								color: colors.textMuted,
								fontSize: typography.fontSize.sm,
							}}
						>
							None of the selected items are assigned to any feeds.
						</p>
					)}
				</div>

				{/* Footer buttons */}
				<div
					css={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}
				>
					<button
						type="button"
						disabled={saving}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							backgroundColor: 'transparent',
							border: `1px solid ${colors.border}`,
							borderRadius: radius.md,
							cursor: saving ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': saving ? {} : { backgroundColor: colors.background },
						}}
						on={{ click: onCancel }}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={saving || !selectedFeedId}
						css={{
							padding: `${spacing.sm} ${spacing.lg}`,
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.background,
							backgroundColor:
								saving || !selectedFeedId ? colors.border : colors.error,
							border: 'none',
							borderRadius: radius.md,
							cursor: saving || !selectedFeedId ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover':
								saving || !selectedFeedId
									? {}
									: { backgroundColor: colors.errorHover },
						}}
						on={{ click: onSave }}
					>
						{saving ? 'Removing...' : 'Remove from Feed'}
					</button>
				</div>
			</div>
		</div>
	)
}

function FeedRadioRowWithCount({
	feedId,
	name,
	updatedAt,
	itemCount,
	totalSelected,
	isSelected,
	onSelect,
}: {
	feedId: string
	name: string
	updatedAt: number
	itemCount: number
	totalSelected: number
	isSelected: boolean
	onSelect: () => void
}) {
	return (
		<button
			type="button"
			css={{
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				padding: spacing.sm,
				backgroundColor: isSelected
					? 'rgba(239, 68, 68, 0.1)'
					: colors.background,
				border: `2px solid ${isSelected ? colors.error : 'transparent'}`,
				borderRadius: radius.md,
				cursor: 'pointer',
				textAlign: 'left',
				width: '100%',
				transition: `all ${transitions.fast}`,
				'&:hover': {
					backgroundColor: isSelected
						? 'rgba(239, 68, 68, 0.15)'
						: colors.surface,
				},
			}}
			on={{ click: onSelect }}
		>
			<div
				css={{
					width: '18px',
					height: '18px',
					borderRadius: '50%',
					border: `2px solid ${isSelected ? colors.error : colors.border}`,
					backgroundColor: isSelected ? colors.error : 'transparent',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0,
				}}
			>
				{isSelected && (
					<div
						css={{
							width: '8px',
							height: '8px',
							borderRadius: '50%',
							backgroundColor: 'white',
						}}
					/>
				)}
			</div>
			<img
				src={`/admin/api/feeds/${feedId}/artwork?t=${updatedAt}`}
				alt=""
				css={{
					width: '32px',
					height: '32px',
					borderRadius: radius.sm,
					objectFit: 'cover',
					flexShrink: 0,
				}}
			/>
			<div css={{ flex: 1, minWidth: 0 }}>
				<div
					css={{
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.medium,
						color: colors.text,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{name}
				</div>
				<div
					css={{
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
					}}
				>
					{itemCount} of {totalSelected} selected item
					{totalSelected !== 1 ? 's' : ''}
				</div>
			</div>
		</button>
	)
}

function FeedRadioRow({
	feedId,
	name,
	updatedAt,
	isSelected,
	onSelect,
}: {
	feedId: string
	name: string
	updatedAt: number
	isSelected: boolean
	onSelect: () => void
}) {
	return (
		<button
			type="button"
			css={{
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				padding: spacing.sm,
				backgroundColor: isSelected
					? 'rgba(59, 130, 246, 0.1)'
					: colors.background,
				border: `2px solid ${isSelected ? colors.primary : 'transparent'}`,
				borderRadius: radius.md,
				cursor: 'pointer',
				textAlign: 'left',
				width: '100%',
				transition: `all ${transitions.fast}`,
				'&:hover': {
					backgroundColor: isSelected
						? 'rgba(59, 130, 246, 0.15)'
						: colors.surface,
				},
			}}
			on={{ click: onSelect }}
		>
			<div
				css={{
					width: '18px',
					height: '18px',
					borderRadius: '50%',
					border: `2px solid ${isSelected ? colors.primary : colors.border}`,
					backgroundColor: isSelected ? colors.primary : 'transparent',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0,
				}}
			>
				{isSelected && (
					<div
						css={{
							width: '8px',
							height: '8px',
							borderRadius: '50%',
							backgroundColor: 'white',
						}}
					/>
				)}
			</div>
			<img
				src={`/admin/api/feeds/${feedId}/artwork?t=${updatedAt}`}
				alt=""
				css={{
					width: '32px',
					height: '32px',
					borderRadius: radius.sm,
					objectFit: 'cover',
					flexShrink: 0,
				}}
			/>
			<span
				css={{
					flex: 1,
					fontSize: typography.fontSize.sm,
					color: colors.text,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{name}
			</span>
		</button>
	)
}

function FeedCheckboxRow({
	feedId,
	name,
	updatedAt,
	isSelected,
	onToggle,
}: {
	feedId: string
	name: string
	updatedAt: number
	isSelected: boolean
	onToggle: () => void
}) {
	return (
		<button
			type="button"
			css={{
				display: 'flex',
				alignItems: 'center',
				gap: spacing.md,
				padding: spacing.sm,
				backgroundColor: isSelected
					? 'rgba(59, 130, 246, 0.1)'
					: colors.background,
				border: `2px solid ${isSelected ? colors.primary : 'transparent'}`,
				borderRadius: radius.md,
				cursor: 'pointer',
				textAlign: 'left',
				width: '100%',
				transition: `all ${transitions.fast}`,
				'&:hover': {
					backgroundColor: isSelected
						? 'rgba(59, 130, 246, 0.15)'
						: colors.surface,
				},
			}}
			on={{ click: onToggle }}
		>
			<div
				css={{
					width: '18px',
					height: '18px',
					borderRadius: radius.sm,
					border: `2px solid ${isSelected ? colors.primary : colors.border}`,
					backgroundColor: isSelected ? colors.primary : 'transparent',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0,
				}}
			>
				{isSelected && (
					<svg
						width="12"
						height="12"
						viewBox="0 0 12 12"
						fill="none"
						css={{ flexShrink: 0 }}
					>
						<path
							d="M2 6L5 9L10 3"
							stroke="white"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				)}
			</div>
			<img
				src={`/admin/api/feeds/${feedId}/artwork?t=${updatedAt}`}
				alt=""
				css={{
					width: '32px',
					height: '32px',
					borderRadius: radius.sm,
					objectFit: 'cover',
					flexShrink: 0,
				}}
			/>
			<span
				css={{
					flex: 1,
					fontSize: typography.fontSize.sm,
					color: colors.text,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{name}
			</span>
		</button>
	)
}
