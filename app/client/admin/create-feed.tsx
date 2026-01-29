import type { Handle, RemixNode } from 'remix/component'
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
import { Link, router } from './router.tsx'

type FeedType = 'directory' | 'curated'

type MediaRoot = {
	name: string
	path: string
}

type DirectoryEntry = {
	name: string
	type: 'directory' | 'file'
}

type BrowseStats = {
	filesInDirectory: number
	filesInSubdirectories: number
	totalFiles: number
}

type SelectedDirectory = {
	mediaRoot: string
	relativePath: string
	displayPath: string // For UI display
}

type DirectoryFormState = {
	name: string
	description: string
	subtitle: string
	selectedRoot: string | null
	currentPath: string
	selectedDirectories: Array<SelectedDirectory>
	sortFields: string
	sortOrder: 'asc' | 'desc'
	feedType: 'episodic' | 'serial'
	link: string
	copyright: string
}

type CuratedFormState = {
	name: string
	description: string
	subtitle: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
	feedType: 'episodic' | 'serial'
	link: string
	copyright: string
	selectedFiles: Array<{
		rootName: string
		relativePath: string
		mediaPath: string // "rootName:relativePath" format
		filename: string
	}>
}

type RootsState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; roots: Array<MediaRoot> }

type BrowseState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; entries: Array<DirectoryEntry>; stats: BrowseStats }

type SubmitState =
	| { status: 'idle' }
	| { status: 'submitting' }
	| { status: 'error'; message: string }

/**
 * CreateFeed component - form for creating a new feed (directory or curated).
 */
export function CreateFeed(handle: Handle) {
	// Feed type selection
	let feedType: FeedType = 'directory'

	// Directory form state
	let directoryForm: DirectoryFormState = {
		name: '',
		description: '',
		subtitle: '',
		selectedRoot: null,
		currentPath: '',
		selectedDirectories: [],
		sortFields: 'publicationDate',
		sortOrder: 'desc',
		feedType: 'episodic',
		link: '',
		copyright: '',
	}

	// Curated form state
	let curatedForm: CuratedFormState = {
		name: '',
		description: '',
		subtitle: '',
		sortFields: 'publicationDate',
		sortOrder: 'desc',
		feedType: 'episodic',
		link: '',
		copyright: '',
		selectedFiles: [],
	}

	// File picker state for curated feeds
	let pickerRoot: string | null = null
	let pickerPath = ''
	let pickerSearch = ''

	// API states
	let rootsState: RootsState = { status: 'loading' }
	let browseState: BrowseState = { status: 'idle' }
	let submitState: SubmitState = { status: 'idle' }

	// Fetch media roots on mount
	// Uses router.requestRouteUpdate() to work around a Remix vdom issue.
	fetch('/admin/api/directories', { signal: handle.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<{ roots: Array<MediaRoot> }>
		})
		.then((data) => {
			rootsState = { status: 'success', roots: data.roots }
			router.requestRouteUpdate()
		})
		.catch((err) => {
			if (handle.signal.aborted) return
			rootsState = { status: 'error', message: err.message }
			router.requestRouteUpdate()
		})

	// Browse a directory
	const browse = (rootName: string, path: string) => {
		browseState = { status: 'loading' }
		handle.update()

		const params = new URLSearchParams({ root: rootName, path })
		fetch(`/admin/api/browse?${params}`, { signal: handle.signal })
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.json() as Promise<{
					entries: Array<DirectoryEntry>
					stats: BrowseStats
				}>
			})
			.then((data) => {
				browseState = {
					status: 'success',
					entries: data.entries,
					stats: data.stats,
				}
				handle.update()
			})
			.catch((err) => {
				if (handle.signal.aborted) return
				browseState = { status: 'error', message: err.message }
				handle.update()
			})
	}

	// === Directory Feed Functions ===

	const selectDirectoryRoot = (rootName: string) => {
		if (rootsState.status !== 'success') return
		directoryForm.selectedRoot = rootName
		directoryForm.currentPath = ''
		browse(rootName, '')
	}

	const navigateDirectoryToDir = (dirName: string) => {
		if (!directoryForm.selectedRoot) return
		const newPath = directoryForm.currentPath
			? `${directoryForm.currentPath}/${dirName}`
			: dirName
		directoryForm.currentPath = newPath
		browse(directoryForm.selectedRoot, newPath)
	}

	const navigateDirectoryUp = () => {
		if (!directoryForm.selectedRoot || !directoryForm.currentPath) return
		const parts = directoryForm.currentPath.split('/')
		parts.pop()
		directoryForm.currentPath = parts.join('/')
		browse(directoryForm.selectedRoot, directoryForm.currentPath)
	}

	const addCurrentDirectory = () => {
		if (!directoryForm.selectedRoot) return

		const mediaRoot = directoryForm.selectedRoot
		const relativePath = directoryForm.currentPath
		const displayPath = relativePath
			? `${mediaRoot}:${relativePath}`
			: mediaRoot

		// Check if already selected
		const exists = directoryForm.selectedDirectories.some(
			(d) => d.mediaRoot === mediaRoot && d.relativePath === relativePath,
		)
		if (exists) return

		directoryForm.selectedDirectories.push({
			mediaRoot,
			relativePath,
			displayPath,
		})
		handle.update()
	}

	const removeDirectory = (index: number) => {
		directoryForm.selectedDirectories.splice(index, 1)
		handle.update()
	}

	const isCurrentDirectorySelected = (): boolean => {
		if (!directoryForm.selectedRoot) return false
		return directoryForm.selectedDirectories.some(
			(d) =>
				d.mediaRoot === directoryForm.selectedRoot &&
				d.relativePath === directoryForm.currentPath,
		)
	}

	const handleDirectorySubmit = async () => {
		if (
			!directoryForm.name.trim() ||
			directoryForm.selectedDirectories.length === 0
		)
			return

		submitState = { status: 'submitting' }
		handle.update()

		try {
			// Convert to "mediaRoot:relativePath" format
			const directoryPaths = directoryForm.selectedDirectories.map((d) =>
				d.relativePath ? `${d.mediaRoot}:${d.relativePath}` : d.mediaRoot,
			)

			const res = await fetch('/admin/api/feeds/directory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: directoryForm.name.trim(),
					description: directoryForm.description.trim() || undefined,
					subtitle: directoryForm.subtitle.trim() || undefined,
					directoryPaths,
					sortFields: directoryForm.sortFields,
					sortOrder: directoryForm.sortOrder,
					feedType: directoryForm.feedType,
					link: directoryForm.link.trim() || undefined,
					copyright: directoryForm.copyright.trim() || undefined,
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			router.navigate('/admin')
		} catch (err) {
			submitState = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			handle.update()
		}
	}

	// === Curated Feed Functions ===

	const selectPickerRoot = (rootName: string) => {
		if (rootsState.status !== 'success') return
		pickerRoot = rootName
		pickerPath = ''
		pickerSearch = ''
		browse(rootName, '')
	}

	const navigatePickerToDir = (dirName: string) => {
		if (!pickerRoot) return
		const newPath = pickerPath ? `${pickerPath}/${dirName}` : dirName
		pickerPath = newPath
		pickerSearch = ''
		browse(pickerRoot, newPath)
	}

	const navigatePickerUp = () => {
		if (!pickerRoot || !pickerPath) return
		const parts = pickerPath.split('/')
		parts.pop()
		pickerPath = parts.join('/')
		pickerSearch = ''
		browse(pickerRoot, pickerPath)
	}

	const toggleFileSelection = (filename: string) => {
		if (!pickerRoot) return

		const relativePath = pickerPath ? `${pickerPath}/${filename}` : filename
		const mediaPath = relativePath
			? `${pickerRoot}:${relativePath}`
			: pickerRoot

		const existingIndex = curatedForm.selectedFiles.findIndex(
			(f) => f.mediaPath === mediaPath,
		)

		if (existingIndex >= 0) {
			// Remove from selection
			curatedForm.selectedFiles.splice(existingIndex, 1)
		} else {
			// Add to selection
			curatedForm.selectedFiles.push({
				rootName: pickerRoot,
				relativePath,
				mediaPath,
				filename,
			})
		}
		handle.update()
	}

	const isFileSelected = (filename: string): boolean => {
		if (!pickerRoot) return false

		const relativePath = pickerPath ? `${pickerPath}/${filename}` : filename
		const mediaPath = relativePath
			? `${pickerRoot}:${relativePath}`
			: pickerRoot

		return curatedForm.selectedFiles.some((f) => f.mediaPath === mediaPath)
	}

	const removeSelectedFile = (mediaPath: string) => {
		const index = curatedForm.selectedFiles.findIndex(
			(f) => f.mediaPath === mediaPath,
		)
		if (index >= 0) {
			curatedForm.selectedFiles.splice(index, 1)
			handle.update()
		}
	}

	const handleCuratedSubmit = async () => {
		if (!curatedForm.name.trim()) return

		submitState = { status: 'submitting' }
		handle.update()

		try {
			const res = await fetch('/admin/api/feeds/curated', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: curatedForm.name.trim(),
					description: curatedForm.description.trim() || undefined,
					subtitle: curatedForm.subtitle.trim() || undefined,
					sortFields: curatedForm.sortFields,
					sortOrder: curatedForm.sortOrder,
					feedType: curatedForm.feedType,
					link: curatedForm.link.trim() || undefined,
					copyright: curatedForm.copyright.trim() || undefined,
					items: curatedForm.selectedFiles.map((f) => f.mediaPath),
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			router.navigate('/admin')
		} catch (err) {
			submitState = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			handle.update()
		}
	}

	return () => {
		const canSubmitDirectory = Boolean(
			directoryForm.name.trim() &&
				directoryForm.selectedDirectories.length > 0 &&
				submitState.status !== 'submitting',
		)

		const canSubmitCurated = Boolean(
			curatedForm.name.trim() && submitState.status !== 'submitting',
		)

		return (
			<div>
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
							[mq.mobile]: {
								fontSize: typography.fontSize.lg,
							},
						}}
					>
						Create New Feed
					</h2>
				</div>

				{/* Feed Type Selector */}
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
					<span
						css={{
							display: 'block',
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.medium,
							color: colors.text,
							marginBottom: spacing.md,
						}}
					>
						Feed Type
					</span>
					<div
						css={{
							display: 'flex',
							gap: spacing.md,
							[mq.mobile]: {
								flexDirection: 'column',
							},
						}}
					>
						<FeedTypeButton
							selected={feedType === 'directory'}
							onClick={() => {
								feedType = 'directory'
								browseState = { status: 'idle' }
								handle.update()
							}}
							title="Directory Feed"
							description="Automatically includes all media files from one or more folders"
						/>
						<FeedTypeButton
							selected={feedType === 'curated'}
							onClick={() => {
								feedType = 'curated'
								browseState = { status: 'idle' }
								pickerRoot = null
								pickerPath = ''
								handle.update()
							}}
							title="Curated Feed"
							description="Manually select specific files to include"
						/>
					</div>
				</div>

				{/* Directory Feed Form */}
				{feedType === 'directory' && (
					<div
						css={{
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							boxShadow: shadows.sm,
						}}
					>
						<FormField id="directory-feed-name" label="Name" required>
							<input
								id="directory-feed-name"
								type="text"
								value={directoryForm.name}
								placeholder="My Audiobooks"
								css={inputStyles}
								on={{
									input: (e) => {
										directoryForm.name = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="directory-feed-description"
							label="Description"
							description="Falls back to subtitle if not provided."
						>
							<textarea
								id="directory-feed-description"
								value={directoryForm.description}
								placeholder="Optional description for this feed"
								rows={3}
								css={{ ...inputStyles, resize: 'vertical', minHeight: '80px' }}
								on={{
									input: (e) => {
										directoryForm.description = (
											e.target as HTMLTextAreaElement
										).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="directory-feed-subtitle"
							label="Subtitle"
							description="A short tagline shown in podcast apps (max 255 characters). Falls back to a truncated description if not provided."
						>
							<input
								id="directory-feed-subtitle"
								type="text"
								value={directoryForm.subtitle}
								placeholder="Optional short tagline"
								maxLength={255}
								css={inputStyles}
								on={{
									input: (e) => {
										directoryForm.subtitle = (
											e.target as HTMLInputElement
										).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="directory-feed-type"
							label="Feed Type"
							description="Episodic: Episodes can be listened to in any order (default for most podcasts). Serial: Episodes should be listened to in sequence (like audiobooks or story-driven series)."
						>
							<select
								id="directory-feed-type"
								value={directoryForm.feedType}
								css={inputStyles}
								on={{
									change: (e) => {
										directoryForm.feedType = (e.target as HTMLSelectElement)
											.value as 'episodic' | 'serial'
										handle.update()
									},
								}}
							>
								<option value="episodic">Episodic</option>
								<option value="serial">Serial</option>
							</select>
						</FormField>

						<FormField
							id="directory-feed-link"
							label="Website Link"
							description="A link to the podcast's website. Defaults to the feed page if not provided."
						>
							<input
								id="directory-feed-link"
								type="url"
								value={directoryForm.link}
								placeholder="https://example.com"
								css={inputStyles}
								on={{
									input: (e) => {
										directoryForm.link = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="directory-feed-copyright"
							label="Copyright"
							description="Copyright notice for the feed content."
						>
							<input
								id="directory-feed-copyright"
								type="text"
								value={directoryForm.copyright}
								placeholder="© 2024 Your Name"
								css={inputStyles}
								on={{
									input: (e) => {
										directoryForm.copyright = (
											e.target as HTMLInputElement
										).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField label="Select Directories" required>
							{rootsState.status === 'loading' && (
								<p css={{ color: colors.textMuted, margin: 0 }}>
									Loading media roots...
								</p>
							)}
							{rootsState.status === 'error' && (
								<p css={{ color: '#ef4444', margin: 0 }}>
									Error: {rootsState.message}
								</p>
							)}
							{rootsState.status === 'success' && (
								<div>
									<div
										css={{
											display: 'flex',
											gap: spacing.sm,
											flexWrap: 'wrap',
											marginBottom: spacing.md,
										}}
									>
										{rootsState.roots.map((root) => (
											<button
												key={root.name}
												type="button"
												css={{
													padding: `${spacing.sm} ${spacing.md}`,
													fontSize: typography.fontSize.sm,
													borderRadius: radius.md,
													border: `1px solid ${directoryForm.selectedRoot === root.name ? colors.primary : colors.border}`,
													backgroundColor:
														directoryForm.selectedRoot === root.name
															? colors.primary
															: colors.background,
													color:
														directoryForm.selectedRoot === root.name
															? colors.background
															: colors.text,
													cursor: 'pointer',
													transition: `all ${transitions.fast}`,
													'&:hover': {
														borderColor: colors.primary,
													},
												}}
												on={{ click: () => selectDirectoryRoot(root.name) }}
											>
												{root.name}
											</button>
										))}
									</div>

									{directoryForm.selectedRoot && (
										<DirectoryBrowserWithAdd
											rootName={directoryForm.selectedRoot}
											currentPath={directoryForm.currentPath}
											browseState={browseState}
											onNavigateUp={navigateDirectoryUp}
											onNavigateToDir={navigateDirectoryToDir}
											onAddDirectory={addCurrentDirectory}
											isCurrentSelected={isCurrentDirectorySelected()}
										/>
									)}
								</div>
							)}
						</FormField>

						{directoryForm.selectedDirectories.length > 0 && (
							<FormField
								label={`Selected Directories (${directoryForm.selectedDirectories.length})`}
							>
								<SelectedDirectoriesList
									directories={directoryForm.selectedDirectories}
									onRemove={removeDirectory}
								/>
							</FormField>
						)}

						<div
							css={{
								display: 'grid',
								gridTemplateColumns: '1fr 1fr',
								gap: spacing.lg,
								[mq.mobile]: {
									gridTemplateColumns: '1fr',
								},
							}}
						>
							<FormField id="directory-feed-sort-fields" label="Sort By">
								<select
									id="directory-feed-sort-fields"
									value={directoryForm.sortFields}
									css={inputStyles}
									on={{
										change: (e) => {
											directoryForm.sortFields = (
												e.target as HTMLSelectElement
											).value
											handle.update()
										},
									}}
								>
									<option value="publicationDate">Publication Date</option>
									<option value="title">Title</option>
									<option value="author">Author</option>
									<option value="trackNumber">Track Number</option>
									<option value="duration">Duration</option>
									<option value="filename">Filename</option>
									<option value="fileModifiedAt">Date Modified</option>
									<option value="size">File Size</option>
								</select>
							</FormField>

							<FormField id="directory-feed-sort-order" label="Order">
								<select
									id="directory-feed-sort-order"
									value={directoryForm.sortOrder}
									css={inputStyles}
									on={{
										change: (e) => {
											directoryForm.sortOrder = (e.target as HTMLSelectElement)
												.value as 'asc' | 'desc'
											handle.update()
										},
									}}
								>
									<option value="desc">Descending</option>
									<option value="asc">Ascending</option>
								</select>
							</FormField>
						</div>

						{submitState.status === 'error' && (
							<ErrorBox message={submitState.message} />
						)}

						<FormActions
							canSubmit={canSubmitDirectory}
							isSubmitting={submitState.status === 'submitting'}
							onSubmit={handleDirectorySubmit}
						/>
					</div>
				)}

				{/* Curated Feed Form */}
				{feedType === 'curated' && (
					<div
						css={{
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: responsive.spacingSection,
							boxShadow: shadows.sm,
						}}
					>
						<FormField id="curated-feed-name" label="Name" required>
							<input
								id="curated-feed-name"
								type="text"
								value={curatedForm.name}
								placeholder="My Custom Playlist"
								css={inputStyles}
								on={{
									input: (e) => {
										curatedForm.name = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="curated-feed-description"
							label="Description"
							description="Falls back to subtitle if not provided."
						>
							<textarea
								id="curated-feed-description"
								value={curatedForm.description}
								placeholder="Optional description for this feed"
								rows={3}
								css={{ ...inputStyles, resize: 'vertical', minHeight: '80px' }}
								on={{
									input: (e) => {
										curatedForm.description = (
											e.target as HTMLTextAreaElement
										).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="curated-feed-subtitle"
							label="Subtitle"
							description="A short tagline shown in podcast apps (max 255 characters). Falls back to a truncated description if not provided."
						>
							<input
								id="curated-feed-subtitle"
								type="text"
								value={curatedForm.subtitle}
								placeholder="Optional short tagline"
								maxLength={255}
								css={inputStyles}
								on={{
									input: (e) => {
										curatedForm.subtitle = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="curated-feed-type"
							label="Feed Type"
							description="Episodic: Episodes can be listened to in any order (default for most podcasts). Serial: Episodes should be listened to in sequence (like audiobooks or story-driven series)."
						>
							<select
								id="curated-feed-type"
								value={curatedForm.feedType}
								css={inputStyles}
								on={{
									change: (e) => {
										curatedForm.feedType = (e.target as HTMLSelectElement)
											.value as 'episodic' | 'serial'
										handle.update()
									},
								}}
							>
								<option value="episodic">Episodic</option>
								<option value="serial">Serial</option>
							</select>
						</FormField>

						<FormField
							id="curated-feed-link"
							label="Website Link"
							description="A link to the podcast's website. Defaults to the feed page if not provided."
						>
							<input
								id="curated-feed-link"
								type="url"
								value={curatedForm.link}
								placeholder="https://example.com"
								css={inputStyles}
								on={{
									input: (e) => {
										curatedForm.link = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField
							id="curated-feed-copyright"
							label="Copyright"
							description="Copyright notice for the feed content."
						>
							<input
								id="curated-feed-copyright"
								type="text"
								value={curatedForm.copyright}
								placeholder="© 2024 Your Name"
								css={inputStyles}
								on={{
									input: (e) => {
										curatedForm.copyright = (e.target as HTMLInputElement).value
										handle.update()
									},
								}}
							/>
						</FormField>

						<FormField label="Select Files">
							{rootsState.status === 'loading' && (
								<p css={{ color: colors.textMuted, margin: 0 }}>
									Loading media roots...
								</p>
							)}
							{rootsState.status === 'error' && (
								<p css={{ color: '#ef4444', margin: 0 }}>
									Error: {rootsState.message}
								</p>
							)}
							{rootsState.status === 'success' && (
								<FilePicker
									roots={rootsState.roots}
									pickerRoot={pickerRoot}
									pickerPath={pickerPath}
									browseState={browseState}
									searchFilter={pickerSearch}
									onSearchChange={(value) => {
										pickerSearch = value
										handle.update()
									}}
									onSelectRoot={selectPickerRoot}
									onNavigateToDir={navigatePickerToDir}
									onNavigateUp={navigatePickerUp}
									onToggleFile={toggleFileSelection}
									isFileSelected={isFileSelected}
								/>
							)}
						</FormField>

						{curatedForm.selectedFiles.length > 0 && (
							<FormField
								label={`Selected Files (${curatedForm.selectedFiles.length})`}
							>
								<SelectedFilesList
									files={curatedForm.selectedFiles}
									onRemove={removeSelectedFile}
								/>
							</FormField>
						)}

						<div
							css={{
								display: 'grid',
								gridTemplateColumns: '1fr 1fr',
								gap: spacing.lg,
								[mq.mobile]: {
									gridTemplateColumns: '1fr',
								},
							}}
						>
							<FormField id="curated-feed-sort-fields" label="Sort By">
								<select
									id="curated-feed-sort-fields"
									value={curatedForm.sortFields}
									css={inputStyles}
									on={{
										change: (e) => {
											curatedForm.sortFields = (
												e.target as HTMLSelectElement
											).value
											handle.update()
										},
									}}
								>
									<option value="publicationDate">Publication Date</option>
									<option value="title">Title</option>
									<option value="author">Author</option>
									<option value="trackNumber">Track Number</option>
									<option value="duration">Duration</option>
									<option value="position">Manual Order</option>
									<option value="filename">Filename</option>
									<option value="fileModifiedAt">Date Modified</option>
									<option value="size">File Size</option>
								</select>
							</FormField>

							<FormField id="curated-feed-sort-order" label="Order">
								<select
									id="curated-feed-sort-order"
									value={curatedForm.sortOrder}
									css={inputStyles}
									on={{
										change: (e) => {
											curatedForm.sortOrder = (e.target as HTMLSelectElement)
												.value as 'asc' | 'desc'
											handle.update()
										},
									}}
								>
									<option value="desc">Descending</option>
									<option value="asc">Ascending</option>
								</select>
							</FormField>
						</div>

						{submitState.status === 'error' && (
							<ErrorBox message={submitState.message} />
						)}

						<FormActions
							canSubmit={canSubmitCurated}
							isSubmitting={submitState.status === 'submitting'}
							onSubmit={handleCuratedSubmit}
						/>
					</div>
				)}
			</div>
		)
	}
}

// === Shared Styles ===

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

// === Helper Components ===

function FeedTypeButton() {
	return ({
		selected,
		onClick,
		title,
		description,
	}: {
		selected: boolean
		onClick: () => void
		title: string
		description: string
	}) => (
		<button
			type="button"
			css={{
				flex: 1,
				padding: spacing.lg,
				textAlign: 'left',
				borderRadius: radius.md,
				border: `2px solid ${selected ? colors.primary : colors.border}`,
				backgroundColor: selected ? colors.primarySoftest : colors.background,
				cursor: 'pointer',
				transition: `all ${transitions.fast}`,
				'&:hover': {
					borderColor: colors.primary,
				},
			}}
			on={{ click: onClick }}
		>
			<div
				css={{
					fontSize: typography.fontSize.base,
					fontWeight: typography.fontWeight.semibold,
					color: colors.text,
					marginBottom: spacing.xs,
				}}
			>
				{title}
			</div>
			<div
				css={{
					fontSize: typography.fontSize.sm,
					color: colors.textMuted,
				}}
			>
				{description}
			</div>
		</button>
	)
}

function FormField() {
	return ({
		id,
		label,
		required,
		description,
		children,
	}: {
		id?: string
		label: string
		required?: boolean
		description?: string
		children: RemixNode
	}) => (
		<div css={{ marginBottom: spacing.lg }}>
			<label
				for={id}
				css={{
					display: 'block',
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.text,
					marginBottom: spacing.xs,
				}}
			>
				{label}
				{required && (
					<span css={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
				)}
			</label>
			{description && (
				<p
					css={{
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						margin: `0 0 ${spacing.sm} 0`,
						lineHeight: 1.5,
					}}
				>
					{description}
				</p>
			)}
			{children}
		</div>
	)
}

function ErrorBox() {
	return ({ message }: { message: string }) => (
		<div
			css={{
				padding: spacing.md,
				backgroundColor: 'rgba(239, 68, 68, 0.1)',
				borderRadius: radius.md,
				border: '1px solid rgba(239, 68, 68, 0.3)',
				marginTop: spacing.lg,
			}}
		>
			<p css={{ color: '#ef4444', margin: 0 }}>{message}</p>
		</div>
	)
}

function FormActions() {
	return ({
		canSubmit,
		isSubmitting,
		onSubmit,
	}: {
		canSubmit: boolean
		isSubmitting: boolean
		onSubmit: () => void
	}) => (
		<div
			css={{
				display: 'flex',
				gap: spacing.md,
				justifyContent: 'flex-end',
				marginTop: spacing.xl,
				paddingTop: spacing.lg,
				borderTop: `1px solid ${colors.border}`,
				flexWrap: 'wrap',
				[mq.mobile]: {
					flexDirection: 'column-reverse',
				},
			}}
		>
			<Link
				href="/admin"
				css={{
					padding: `${spacing.sm} ${spacing.lg}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.text,
					backgroundColor: colors.background,
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					textDecoration: 'none',
					textAlign: 'center',
					cursor: 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover': {
						backgroundColor: colors.surface,
					},
				}}
			>
				Cancel
			</Link>
			<button
				type="button"
				disabled={!canSubmit}
				css={{
					padding: `${spacing.sm} ${spacing.lg}`,
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.background,
					backgroundColor: canSubmit ? colors.primary : colors.border,
					border: 'none',
					borderRadius: radius.md,
					cursor: canSubmit ? 'pointer' : 'not-allowed',
					transition: `all ${transitions.fast}`,
					'&:hover': canSubmit ? { backgroundColor: colors.primaryHover } : {},
				}}
				on={{ click: onSubmit }}
			>
				{isSubmitting ? 'Creating...' : 'Create Feed'}
			</button>
		</div>
	)
}

function DirectoryBrowserWithAdd() {
	return ({
		rootName,
		currentPath,
		browseState,
		onNavigateUp,
		onNavigateToDir,
		onAddDirectory,
		isCurrentSelected,
	}: {
		rootName: string
		currentPath: string
		browseState: BrowseState
		onNavigateUp: () => void
		onNavigateToDir: (name: string) => void
		onAddDirectory: () => void
		isCurrentSelected: boolean
	}) => {
		const pathParts = currentPath ? currentPath.split('/') : []

		return (
			<div
				css={{
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					overflow: 'hidden',
				}}
			>
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
						justifyContent: 'space-between',
					}}
				>
					<div css={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
						<span css={{ color: colors.primary }}>{rootName}</span>
						{pathParts.map((part, i) => (
							<span key={i}>
								<span css={{ color: colors.textMuted }}>/</span>
								<span>{part}</span>
							</span>
						))}
						{!currentPath && <span css={{ color: colors.textMuted }}>/</span>}
					</div>
					<button
						type="button"
						disabled={isCurrentSelected}
						css={{
							padding: `${spacing.xs} ${spacing.sm}`,
							fontSize: typography.fontSize.xs,
							fontWeight: typography.fontWeight.medium,
							borderRadius: radius.sm,
							border: 'none',
							backgroundColor: isCurrentSelected
								? colors.border
								: colors.primary,
							color: colors.background,
							cursor: isCurrentSelected ? 'not-allowed' : 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': isCurrentSelected
								? {}
								: { backgroundColor: colors.primaryHover },
						}}
						on={{ click: onAddDirectory }}
					>
						{isCurrentSelected ? 'Added' : '+ Add This Directory'}
					</button>
				</div>

				<div
					css={{
						maxHeight: '300px',
						overflowY: 'auto',
						backgroundColor: colors.surface,
					}}
				>
					{browseState.status === 'loading' && (
						<div css={{ padding: spacing.lg, textAlign: 'center' }}>
							<span css={{ color: colors.textMuted }}>Loading...</span>
						</div>
					)}

					{browseState.status === 'error' && (
						<div css={{ padding: spacing.lg, textAlign: 'center' }}>
							<span css={{ color: '#ef4444' }}>{browseState.message}</span>
						</div>
					)}

					{browseState.status === 'success' && (
						<div>
							{currentPath && (
								<button
									type="button"
									css={directoryItemStyles}
									on={{ click: onNavigateUp }}
								>
									<span css={{ marginRight: spacing.sm }}>📁</span>
									<span>..</span>
								</button>
							)}

							{browseState.entries.length === 0 && !currentPath && (
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

							{browseState.entries
								.filter((e) => e.type === 'directory')
								.map((entry) => (
									<button
										key={entry.name}
										type="button"
										css={directoryItemStyles}
										on={{ click: () => onNavigateToDir(entry.name) }}
									>
										<span css={{ marginRight: spacing.sm }}>📁</span>
										<span>{entry.name}</span>
									</button>
								))}

							{browseState.stats.totalFiles > 0 && (
								<div
									css={{
										padding: `${spacing.sm} ${spacing.md}`,
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										borderTop: `1px solid ${colors.border}`,
									}}
								>
									{browseState.stats.filesInDirectory > 0 &&
									browseState.stats.filesInSubdirectories > 0 ? (
										<span>
											{browseState.stats.totalFiles} file(s) total (
											{browseState.stats.filesInDirectory} here,{' '}
											{browseState.stats.filesInSubdirectories} in
											subdirectories)
										</span>
									) : browseState.stats.filesInDirectory > 0 ? (
										<span>
											{browseState.stats.filesInDirectory} file(s) in this
											directory
										</span>
									) : (
										<span>
											{browseState.stats.filesInSubdirectories} file(s) in
											subdirectories
										</span>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		)
	}
}

function SelectedDirectoriesList() {
	return ({
		directories,
		onRemove,
	}: {
		directories: Array<SelectedDirectory>
		onRemove: (index: number) => void
	}) => (
		<div
			css={{
				border: `1px solid ${colors.border}`,
				borderRadius: radius.md,
				maxHeight: '200px',
				overflowY: 'auto',
			}}
		>
			{directories.map((dir, index) => (
				<div
					key={dir.displayPath}
					css={{
						display: 'flex',
						alignItems: 'center',
						padding: `${spacing.sm} ${spacing.md}`,
						borderBottom:
							index < directories.length - 1
								? `1px solid ${colors.border}`
								: 'none',
						backgroundColor: colors.background,
					}}
				>
					<span
						css={{
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							marginRight: spacing.sm,
							minWidth: '24px',
						}}
					>
						{index + 1}.
					</span>
					<span
						css={{
							flex: 1,
							fontSize: typography.fontSize.sm,
							color: colors.text,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							fontFamily: 'monospace',
						}}
					>
						<span css={{ color: colors.primary }}>{dir.mediaRoot}</span>
						{dir.relativePath && (
							<span css={{ color: colors.textMuted }}>:{dir.relativePath}</span>
						)}
					</span>
					<button
						type="button"
						css={{
							padding: `${spacing.xs} ${spacing.sm}`,
							fontSize: typography.fontSize.xs,
							color: '#ef4444',
							backgroundColor: 'transparent',
							border: 'none',
							borderRadius: radius.sm,
							cursor: 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: 'rgba(239, 68, 68, 0.1)',
							},
						}}
						on={{ click: () => onRemove(index) }}
					>
						Remove
					</button>
				</div>
			))}
		</div>
	)
}

function FilePicker() {
	return ({
		roots,
		pickerRoot,
		pickerPath,
		browseState,
		searchFilter,
		onSearchChange,
		onSelectRoot,
		onNavigateToDir,
		onNavigateUp,
		onToggleFile,
		isFileSelected,
	}: {
		roots: Array<MediaRoot>
		pickerRoot: string | null
		pickerPath: string
		browseState: BrowseState
		searchFilter: string
		onSearchChange: (value: string) => void
		onSelectRoot: (name: string) => void
		onNavigateToDir: (name: string) => void
		onNavigateUp: () => void
		onToggleFile: (filename: string) => void
		isFileSelected: (filename: string) => boolean
	}) => {
		const pathParts = pickerPath ? pickerPath.split('/') : []
		const searchLower = searchFilter.toLowerCase()

		return (
			<div
				css={{
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					overflow: 'hidden',
				}}
			>
				{/* Root selector */}
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
					{roots.map((root) => (
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

				{/* Search input */}
				{pickerRoot && browseState.status === 'success' && (
					<div
						css={{
							padding: spacing.sm,
							backgroundColor: colors.background,
							borderBottom: `1px solid ${colors.border}`,
						}}
					>
						<input
							type="text"
							placeholder="Search files..."
							value={searchFilter}
							css={{
								width: '100%',
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
								input: (e) =>
									onSearchChange((e.target as HTMLInputElement).value),
							}}
						/>
					</div>
				)}

				{/* File listing */}
				<div
					css={{
						maxHeight: '300px',
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
									css={directoryItemStyles}
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
								.filter(
									(e) =>
										e.type === 'directory' &&
										e.name.toLowerCase().includes(searchLower),
								)
								.map((entry) => (
									<button
										key={entry.name}
										type="button"
										css={directoryItemStyles}
										on={{ click: () => onNavigateToDir(entry.name) }}
									>
										<span css={{ marginRight: spacing.sm }}>📁</span>
										<span>{entry.name}</span>
									</button>
								))}

							{/* Files with checkboxes */}
							{browseState.entries
								.filter(
									(e) =>
										e.type === 'file' &&
										e.name.toLowerCase().includes(searchLower),
								)
								.map((entry) => {
									const selected = isFileSelected(entry.name)
									return (
										<button
											key={entry.name}
											type="button"
											css={{
												...directoryItemStyles,
												backgroundColor: selected
													? colors.primarySoft
													: 'transparent',
											}}
											on={{ click: () => onToggleFile(entry.name) }}
										>
											<span
												css={{
													marginRight: spacing.sm,
													width: '16px',
													height: '16px',
													border: `1px solid ${selected ? colors.primary : colors.border}`,
													borderRadius: radius.sm,
													backgroundColor: selected
														? colors.primary
														: 'transparent',
													display: 'inline-flex',
													alignItems: 'center',
													justifyContent: 'center',
													fontSize: '12px',
													color: colors.background,
												}}
											>
												{selected && '✓'}
											</span>
											<span css={{ marginRight: spacing.sm }}>📄</span>
											<span>{entry.name}</span>
										</button>
									)
								})}

							{/* File count stats */}
							{browseState.stats.totalFiles > 0 && (
								<div
									css={{
										padding: `${spacing.sm} ${spacing.md}`,
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										borderTop: `1px solid ${colors.border}`,
									}}
								>
									{browseState.stats.filesInDirectory > 0 &&
									browseState.stats.filesInSubdirectories > 0 ? (
										<span>
											{browseState.stats.totalFiles} file(s) total (
											{browseState.stats.filesInDirectory} here,{' '}
											{browseState.stats.filesInSubdirectories} in
											subdirectories)
										</span>
									) : browseState.stats.filesInDirectory > 0 ? (
										<span>
											{browseState.stats.filesInDirectory} file(s) in this
											directory
										</span>
									) : (
										<span>
											{browseState.stats.filesInSubdirectories} file(s) in
											subdirectories
										</span>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		)
	}
}

function SelectedFilesList() {
	return ({
		files,
		onRemove,
	}: {
		files: Array<{
			rootName: string
			relativePath: string
			mediaPath: string
			filename: string
		}>
		onRemove: (mediaPath: string) => void
	}) => (
		<div
			css={{
				border: `1px solid ${colors.border}`,
				borderRadius: radius.md,
				maxHeight: '200px',
				overflowY: 'auto',
			}}
		>
			{files.map((file, index) => (
				<div
					key={file.mediaPath}
					css={{
						display: 'flex',
						alignItems: 'center',
						padding: `${spacing.sm} ${spacing.md}`,
						borderBottom:
							index < files.length - 1 ? `1px solid ${colors.border}` : 'none',
						backgroundColor: colors.background,
					}}
				>
					<span
						css={{
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							marginRight: spacing.sm,
							minWidth: '24px',
						}}
					>
						{index + 1}.
					</span>
					<span
						css={{
							flex: 1,
							fontSize: typography.fontSize.sm,
							color: colors.text,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							fontFamily: 'monospace',
						}}
					>
						<span css={{ color: colors.primary }}>{file.rootName}</span>
						{file.relativePath && (
							<span css={{ color: colors.textMuted }}>
								:{file.relativePath}
							</span>
						)}
					</span>
					<button
						type="button"
						css={{
							padding: `${spacing.xs} ${spacing.sm}`,
							fontSize: typography.fontSize.xs,
							color: '#ef4444',
							backgroundColor: 'transparent',
							border: 'none',
							borderRadius: radius.sm,
							cursor: 'pointer',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: 'rgba(239, 68, 68, 0.1)',
							},
						}}
						on={{ click: () => onRemove(file.mediaPath) }}
					>
						Remove
					</button>
				</div>
			))}
		</div>
	)
}

const directoryItemStyles = {
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
