import type { Handle } from '@remix-run/component'
import {
	breakpoints,
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

type MediaInfo = {
	path: string
	rootName: string
	relativePath: string
	filename: string
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	mimeType: string
	publicationDate: string | null
	trackNumber: number | null
	description: string | null
	narrators: string[] | null
	genres: string[] | null
	copyright: string | null
	fileModifiedAt: number
}

type FeedAssignment = {
	feedId: string
	feedType: 'curated' | 'directory'
	feedName: string
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
	directoryPaths: string[]
	imageUrl: string | null
	updatedAt: number
}

type MediaDetailResponse = {
	media: MediaInfo
	assignments: FeedAssignment[]
	curatedFeeds: CuratedFeed[]
	directoryFeeds: DirectoryFeed[]
}

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: MediaDetailResponse }

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds: number | null): string {
	if (seconds === null || seconds === 0) return '—'

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}h ${minutes}m ${secs}s`
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
 * Format date to human-readable format
 */
function formatDate(dateStr: string | null): string {
	if (!dateStr) return '—'
	const date = new Date(dateStr)
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

/**
 * Check if MIME type is video
 */
function isVideo(mimeType: string): boolean {
	return mimeType.startsWith('video/')
}

/**
 * MediaDetail component - displays full metadata, feed assignments, and media player
 */
export function MediaDetail(this: Handle) {
	let state: LoadingState = { status: 'loading' }
	let currentPath = ''
	let selectedFeedIds: Set<string> = new Set()
	let saving = false
	let saveMessage: { type: 'success' | 'error'; text: string } | null = null

	const fetchMedia = async (encodedPath: string) => {
		currentPath = encodedPath
		state = { status: 'loading' }
		this.update()

		try {
			const res = await fetch(`/admin/api/media/${encodedPath}`, {
				signal: this.signal,
			})

			if (!res.ok) {
				const data = await res.json().catch(() => ({}))
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			const data = (await res.json()) as MediaDetailResponse
			state = { status: 'success', data }

			// Initialize selected feeds from current assignments
			selectedFeedIds = new Set(
				data.assignments
					.filter((a) => a.feedType === 'curated')
					.map((a) => a.feedId),
			)

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

	const toggleFeed = (feedId: string) => {
		if (selectedFeedIds.has(feedId)) {
			selectedFeedIds.delete(feedId)
		} else {
			selectedFeedIds.add(feedId)
		}
		this.update()
	}

	const saveAssignments = async () => {
		if (state.status !== 'success') return

		saving = true
		saveMessage = null
		this.update()

		try {
			const { media } = state.data
			const mediaPath = media.relativePath
				? `${media.rootName}:${media.relativePath}`
				: media.rootName

			const res = await fetch('/admin/api/media/assignments', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaPath,
					feedIds: [...selectedFeedIds],
				}),
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			saveMessage = { type: 'success', text: 'Feed assignments saved' }

			// Refresh data to get updated assignments
			await fetchMedia(currentPath)
		} catch (err) {
			saveMessage = {
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to save',
			}
		} finally {
			saving = false
			this.update()

			// Clear success message after 3 seconds
			if (saveMessage?.type === 'success') {
				setTimeout(() => {
					saveMessage = null
					this.update()
				}, 3000)
			}
		}
	}

	const getArtworkUrl = (media: MediaInfo) => {
		return `/admin/api/artwork/${encodeURIComponent(media.rootName)}/${encodeURIComponent(media.relativePath)}`
	}

	const getStreamUrl = (media: MediaInfo) => {
		return `/admin/api/media-stream/${encodeURIComponent(media.rootName)}/${encodeURIComponent(media.relativePath)}`
	}

	// Check if current feed selection differs from saved assignments
	const hasUnsavedChanges = () => {
		if (state.status !== 'success') return false
		const currentAssignments = new Set(
			state.data.assignments
				.filter((a) => a.feedType === 'curated')
				.map((a) => a.feedId),
		)
		if (selectedFeedIds.size !== currentAssignments.size) return true
		for (const id of selectedFeedIds) {
			if (!currentAssignments.has(id)) return true
		}
		return false
	}

	return () => {
		// Extract path from URL: /admin/media/* -> everything after /admin/media/
		const urlPath = window.location.pathname
		const prefix = '/admin/media/'
		const paramPath = urlPath.startsWith(prefix)
			? urlPath.slice(prefix.length)
			: ''

		if (paramPath && paramPath !== currentPath) {
			setTimeout(() => fetchMedia(paramPath), 0)
		}

		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		if (state.status === 'error') {
			return <ErrorMessage message={state.message} />
		}

		const { media, curatedFeeds, directoryFeeds, assignments } = state.data
		const directoryAssignments = assignments.filter(
			(a) => a.feedType === 'directory',
		)
		const isVideoFile = isVideo(media.mimeType)

		return (
			<div>
				{/* Header */}
				<div
					css={{
						display: 'flex',
						alignItems: 'center',
						gap: spacing.md,
						marginBottom: spacing.xl,
					}}
				>
					<Link
						href="/admin/media"
						css={{
							color: colors.textMuted,
							textDecoration: 'none',
							fontSize: typography.fontSize.sm,
							'&:hover': { color: colors.text },
						}}
					>
						← Back to Media
					</Link>
				</div>

				{/* Main Content Grid */}
				<div
					css={{
						display: 'grid',
						gridTemplateColumns: '1fr',
						gap: responsive.spacingSection,
						[`@media (min-width: ${breakpoints.mobile})` as const]: {
							gridTemplateColumns: '250px 1fr',
						},
						[`@media (min-width: ${breakpoints.tablet})` as const]: {
							gridTemplateColumns: '300px 1fr',
						},
					}}
				>
					{/* Left Column - Artwork */}
					<div>
						{/* Artwork */}
						<div
							css={{
								backgroundColor: colors.surface,
								borderRadius: radius.lg,
								border: `1px solid ${colors.border}`,
								overflow: 'hidden',
								boxShadow: shadows.md,
							}}
						>
							<img
								src={getArtworkUrl(media)}
								alt={media.title}
								css={{
									width: '100%',
									aspectRatio: '1',
									objectFit: 'cover',
									display: 'block',
								}}
							/>
						</div>
					</div>

					{/* Right Column - Metadata & Feeds */}
					<div>
						{/* Title & Author */}
						<div css={{ marginBottom: spacing.lg }}>
							<h1
								css={{
									fontSize: typography.fontSize['2xl'],
									fontWeight: typography.fontWeight.bold,
									color: colors.text,
									margin: 0,
									lineHeight: 1.2,
									[mq.mobile]: {
										fontSize: typography.fontSize.xl,
									},
								}}
							>
								{media.title}
							</h1>
							{media.author && (
								<p
									css={{
										fontSize: typography.fontSize.lg,
										color: colors.textMuted,
										margin: `${spacing.xs} 0 0 0`,
										[mq.mobile]: {
											fontSize: typography.fontSize.base,
										},
									}}
								>
									by {media.author}
								</p>
							)}
						</div>

						{/* Media Player */}
						<div
							css={{
								backgroundColor: colors.surface,
								borderRadius: radius.lg,
								border: `1px solid ${colors.border}`,
								padding: spacing.md,
								marginBottom: spacing.xl,
								boxShadow: shadows.sm,
							}}
						>
							{isVideoFile ? (
								<video
									src={getStreamUrl(media)}
									controls
									preload="metadata"
									css={{
										width: '100%',
										borderRadius: radius.md,
										backgroundColor: '#000',
									}}
								>
									<track kind="captions" />
									Your browser does not support video playback.
								</video>
							) : (
								<audio
									src={getStreamUrl(media)}
									controls
									preload="metadata"
									css={{
										width: '100%',
									}}
								>
									<track kind="captions" />
									Your browser does not support audio playback.
								</audio>
							)}
						</div>

						{/* Metadata Card */}
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
								Details
							</h3>

							<div
								css={{
									display: 'grid',
									gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
									gap: spacing.md,
								}}
							>
								<MetadataItem
									label="Duration"
									value={formatDuration(media.duration)}
								/>
								<MetadataItem
									label="Size"
									value={formatFileSize(media.sizeBytes)}
								/>
								<MetadataItem label="Format" value={media.mimeType} />
								<MetadataItem
									label="Published"
									value={formatDate(media.publicationDate)}
								/>
								{media.trackNumber && (
									<MetadataItem label="Track" value={`#${media.trackNumber}`} />
								)}
								<MetadataItem
									label="Modified"
									value={new Date(
										media.fileModifiedAt * 1000,
									).toLocaleDateString()}
								/>
							</div>

							{media.narrators && media.narrators.length > 0 && (
								<div css={{ marginTop: spacing.md }}>
									<MetadataItem
										label="Narrators"
										value={media.narrators.join(', ')}
									/>
								</div>
							)}

							{media.genres && media.genres.length > 0 && (
								<div css={{ marginTop: spacing.md }}>
									<MetadataItem
										label="Genres"
										value={media.genres.join(', ')}
									/>
								</div>
							)}

							{media.copyright && (
								<div css={{ marginTop: spacing.md }}>
									<MetadataItem label="Copyright" value={media.copyright} />
								</div>
							)}

							{media.description && (
								<div css={{ marginTop: spacing.lg }}>
									<dt
										css={{
											fontSize: typography.fontSize.xs,
											color: colors.textMuted,
											textTransform: 'uppercase',
											letterSpacing: '0.05em',
											marginBottom: spacing.xs,
										}}
									>
										Description
									</dt>
									{/* TODO: Description may contain HTML. Render as HTML when Remix components support dangerouslySetInnerHTML */}
									<dd
										css={{
											fontSize: typography.fontSize.sm,
											color: colors.text,
											margin: 0,
											lineHeight: 1.6,
											whiteSpace: 'pre-wrap',
										}}
									>
										{media.description}
									</dd>
								</div>
							)}

							{/* File Path */}
							<div css={{ marginTop: spacing.lg }}>
								<dt
									css={{
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										textTransform: 'uppercase',
										letterSpacing: '0.05em',
										marginBottom: spacing.xs,
									}}
								>
									File Path
								</dt>
								<dd
									css={{
										fontSize: typography.fontSize.sm,
										color: colors.text,
										margin: 0,
										fontFamily: 'monospace',
										backgroundColor: colors.background,
										padding: spacing.sm,
										borderRadius: radius.sm,
										wordBreak: 'break-all',
									}}
								>
									{media.rootName}:{media.relativePath}
								</dd>
							</div>
						</div>

						{/* Feed Assignments Card */}
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
									Feed Assignments
								</h3>
								{hasUnsavedChanges() && (
									<button
										type="button"
										disabled={saving}
										css={{
											padding: `${spacing.xs} ${spacing.md}`,
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											color: colors.background,
											backgroundColor: saving ? colors.border : colors.primary,
											border: 'none',
											borderRadius: radius.md,
											cursor: saving ? 'not-allowed' : 'pointer',
											transition: `all ${transitions.fast}`,
											'&:hover': saving
												? {}
												: { backgroundColor: colors.primaryHover },
										}}
										on={{ click: saveAssignments }}
									>
										{saving ? 'Saving...' : 'Save Changes'}
									</button>
								)}
							</div>

							{saveMessage && (
								<div
									css={{
										padding: spacing.sm,
										borderRadius: radius.md,
										marginBottom: spacing.md,
										backgroundColor:
											saveMessage.type === 'success'
												? 'rgba(16, 185, 129, 0.1)'
												: 'rgba(239, 68, 68, 0.1)',
										border: `1px solid ${saveMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
									}}
								>
									<p
										css={{
											margin: 0,
											fontSize: typography.fontSize.sm,
											color:
												saveMessage.type === 'success' ? '#10b981' : '#ef4444',
										}}
									>
										{saveMessage.text}
									</p>
								</div>
							)}

							{/* Curated Feeds */}
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
												onToggle={() => toggleFeed(feed.id)}
											/>
										))}
									</div>
								</div>
							)}

							{/* Directory Feeds */}
							{directoryAssignments.length > 0 && (
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
										{directoryAssignments.map((assignment) => {
											const feed = directoryFeeds.find(
												(f) => f.id === assignment.feedId,
											)
											return (
												<div
													key={assignment.feedId}
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
														src={`/admin/api/feeds/${assignment.feedId}/artwork?t=${feed?.updatedAt ?? 0}`}
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
														{assignment.feedName}
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
											)
										})}
									</div>
								</div>
							)}

							{curatedFeeds.length === 0 &&
								directoryAssignments.length === 0 && (
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
					</div>
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
				Failed to load media: {message}
			</p>
			<Link
				href="/admin/media"
				css={{
					display: 'inline-block',
					marginTop: spacing.md,
					color: colors.primary,
					textDecoration: 'none',
					'&:hover': { textDecoration: 'underline' },
				}}
			>
				← Back to media library
			</Link>
		</div>
	)
}

function MetadataItem({ label, value }: { label: string; value: string }) {
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
				}}
			>
				{value}
			</dd>
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
