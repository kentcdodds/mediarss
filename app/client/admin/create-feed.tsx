import type { Handle } from '@remix-run/component'
import {
	colors,
	radius,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'
import { Link, router } from './router.tsx'

type MediaRoot = {
	name: string
	path: string
}

type DirectoryEntry = {
	name: string
	type: 'directory' | 'file'
}

type FormState = {
	name: string
	description: string
	selectedRoot: string | null
	currentPath: string
	sortFields: string
	sortOrder: 'asc' | 'desc'
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

type SubmitState =
	| { status: 'idle' }
	| { status: 'submitting' }
	| { status: 'error'; message: string }

/**
 * CreateFeed component - form for creating a new directory feed.
 */
export function CreateFeed(this: Handle) {
	// Form state
	let form: FormState = {
		name: '',
		description: '',
		selectedRoot: null,
		currentPath: '',
		sortFields: 'filename',
		sortOrder: 'asc',
	}

	// API states
	let rootsState: RootsState = { status: 'loading' }
	let browseState: BrowseState = { status: 'idle' }
	let submitState: SubmitState = { status: 'idle' }

	// Fetch media roots on mount
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

	// Browse a directory (used by navigateToDir and navigateUp)
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

	// Handle root selection
	const selectRoot = (rootName: string) => {
		if (rootsState.status !== 'success') return
		form.selectedRoot = rootName
		form.currentPath = ''
		browseState = { status: 'loading' }
		this.update()

		const params = new URLSearchParams({ root: rootName, path: '' })
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

	// Navigate into a subdirectory
	const navigateToDir = (dirName: string) => {
		if (!form.selectedRoot) return
		const newPath = form.currentPath ? `${form.currentPath}/${dirName}` : dirName
		form.currentPath = newPath
		browse(form.selectedRoot, newPath)
	}

	// Navigate up one level
	const navigateUp = () => {
		if (!form.selectedRoot || !form.currentPath) return
		const parts = form.currentPath.split('/')
		parts.pop()
		form.currentPath = parts.join('/')
		browse(form.selectedRoot, form.currentPath)
	}

	// Get the full directory path for submission
	const getFullPath = (): string | null => {
		if (rootsState.status !== 'success' || !form.selectedRoot) return null
		const root = rootsState.roots.find((r) => r.name === form.selectedRoot)
		if (!root) return null
		return form.currentPath ? `${root.path}/${form.currentPath}` : root.path
	}

	// Handle form submission
	const handleSubmit = async () => {
		const directoryPath = getFullPath()
		if (!form.name.trim() || !directoryPath) return

		submitState = { status: 'submitting' }
		this.update()

		try {
			const res = await fetch('/admin/api/feeds/directory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: form.name.trim(),
					description: form.description.trim() || undefined,
					directoryPath,
					sortFields: form.sortFields,
					sortOrder: form.sortOrder,
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Success - navigate back to feed list
			router.navigate('/admin')
		} catch (err) {
			submitState = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			this.update()
		}
	}

	return () => {
		const canSubmit =
			form.name.trim() &&
			form.selectedRoot &&
			submitState.status !== 'submitting'

		return (
			<div>
				<div
					css={{
						display: 'flex',
						alignItems: 'center',
						gap: spacing.md,
						marginBottom: spacing.xl,
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
						}}
					>
						Create Directory Feed
					</h2>
				</div>

				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: spacing.xl,
						boxShadow: shadows.sm,
					}}
				>
					{/* Name field */}
					<FormField label="Name" required>
						<input
							type="text"
							value={form.name}
							placeholder="My Audiobooks"
							css={inputStyles}
							on={{
								input: (e) => {
									form.name = (e.target as HTMLInputElement).value
									this.update()
								},
							}}
						/>
					</FormField>

					{/* Description field */}
					<FormField label="Description">
						<textarea
							value={form.description}
							placeholder="Optional description for this feed"
							rows={3}
							css={{ ...inputStyles, resize: 'vertical', minHeight: '80px' }}
							on={{
								input: (e) => {
									form.description = (e.target as HTMLTextAreaElement).value
									this.update()
								},
							}}
						/>
					</FormField>

					{/* Media Root Selection */}
					<FormField label="Media Root" required>
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
							<div css={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
								{rootsState.roots.map((root) => (
									<button
										key={root.name}
										type="button"
										css={{
											padding: `${spacing.sm} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											borderRadius: radius.md,
											border: `1px solid ${form.selectedRoot === root.name ? colors.primary : colors.border}`,
											backgroundColor:
												form.selectedRoot === root.name
													? colors.primary
													: colors.background,
											color:
												form.selectedRoot === root.name
													? colors.background
													: colors.text,
											cursor: 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': {
												borderColor: colors.primary,
											},
										}}
										on={{ click: () => selectRoot(root.name) }}
									>
										{root.name}
									</button>
								))}
							</div>
						)}
					</FormField>

					{/* Directory Browser */}
					{form.selectedRoot && (
						<FormField label="Directory">
							<DirectoryBrowser
								rootName={form.selectedRoot}
								currentPath={form.currentPath}
								browseState={browseState}
								onNavigateUp={navigateUp}
								onNavigateToDir={navigateToDir}
							/>
						</FormField>
					)}

					{/* Sort Options */}
					<div
						css={{
							display: 'grid',
							gridTemplateColumns: '1fr 1fr',
							gap: spacing.lg,
						}}
					>
						<FormField label="Sort By">
							<select
								value={form.sortFields}
								css={inputStyles}
								on={{
									change: (e) => {
										form.sortFields = (e.target as HTMLSelectElement).value
										this.update()
									},
								}}
							>
								<option value="filename">Filename</option>
								<option value="date">Date Modified</option>
								<option value="size">File Size</option>
							</select>
						</FormField>

						<FormField label="Order">
							<select
								value={form.sortOrder}
								css={inputStyles}
								on={{
									change: (e) => {
										form.sortOrder = (e.target as HTMLSelectElement).value as
											| 'asc'
											| 'desc'
										this.update()
									},
								}}
							>
								<option value="asc">Ascending</option>
								<option value="desc">Descending</option>
							</select>
						</FormField>
					</div>

					{/* Error message */}
					{submitState.status === 'error' && (
						<div
							css={{
								padding: spacing.md,
								backgroundColor: 'rgba(239, 68, 68, 0.1)',
								borderRadius: radius.md,
								border: '1px solid rgba(239, 68, 68, 0.3)',
								marginTop: spacing.lg,
							}}
						>
							<p css={{ color: '#ef4444', margin: 0 }}>
								{submitState.message}
							</p>
						</div>
					)}

					{/* Actions */}
					<div
						css={{
							display: 'flex',
							gap: spacing.md,
							justifyContent: 'flex-end',
							marginTop: spacing.xl,
							paddingTop: spacing.lg,
							borderTop: `1px solid ${colors.border}`,
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
								'&:hover': canSubmit
									? { backgroundColor: colors.primaryHover }
									: {},
							}}
							on={{ click: handleSubmit }}
						>
							{submitState.status === 'submitting'
								? 'Creating...'
								: 'Create Feed'}
						</button>
					</div>
				</div>
			</div>
		)
	}
}

// Shared input styles
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

// Form field wrapper component
function FormField({
	label,
	required,
	children,
}: {
	label: string
	required?: boolean
	children: JSX.Element
}) {
	return (
		<div css={{ marginBottom: spacing.lg }}>
			<label
				css={{
					display: 'block',
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.medium,
					color: colors.text,
					marginBottom: spacing.sm,
				}}
			>
				{label}
				{required && <span css={{ color: '#ef4444', marginLeft: '4px' }}>*</span>}
			</label>
			{children}
		</div>
	)
}

// Directory browser component
function DirectoryBrowser({
	rootName,
	currentPath,
	browseState,
	onNavigateUp,
	onNavigateToDir,
}: {
	rootName: string
	currentPath: string
	browseState: BrowseState
	onNavigateUp: () => void
	onNavigateToDir: (name: string) => void
}) {
	const pathParts = currentPath ? currentPath.split('/') : []

	return (
		<div
			css={{
				border: `1px solid ${colors.border}`,
				borderRadius: radius.md,
				overflow: 'hidden',
			}}
		>
			{/* Path breadcrumb */}
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
				<span css={{ color: colors.primary }}>{rootName}</span>
				{pathParts.map((part, i) => (
					<span key={i}>
						<span css={{ color: colors.textMuted }}>/</span>
						<span>{part}</span>
					</span>
				))}
				{!currentPath && <span css={{ color: colors.textMuted }}>/</span>}
			</div>

			{/* Directory listing */}
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
						{/* Parent directory link */}
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

						{/* Directory entries */}
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

						{/* Show file count */}
						{browseState.entries.filter((e) => e.type === 'file').length > 0 && (
							<div
								css={{
									padding: `${spacing.sm} ${spacing.md}`,
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									borderTop: `1px solid ${colors.border}`,
								}}
							>
								{browseState.entries.filter((e) => e.type === 'file').length}{' '}
								file(s) in this directory
							</div>
						)}
					</div>
				)}
			</div>
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
