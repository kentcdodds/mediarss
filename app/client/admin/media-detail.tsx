import type { Handle } from 'remix/component'
import {
	formatDate,
	formatDuration,
	formatFileSize,
	formatRelativeTime,
} from '#app/helpers/format.ts'
import {
	artworkLayout,
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
import { AnalyticsDailyActivityChart } from './analytics-daily-activity-chart.tsx'
import { AnalyticsMetricCard } from './analytics-metric-card.tsx'
import { AnalyticsTopClientsList } from './analytics-top-clients-list.tsx'
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
	// Additional metadata fields
	album: string | null
	albumArtist: string | null
	composer: string | null
	publisher: string | null
	discNumber: number | null
	totalDiscs: number | null
	totalTracks: number | null
	language: string | null
	series: string | null
	seriesPosition: string | null
	encodedBy: string | null
	subtitle: string | null
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

type MediaAnalyticsSummary = {
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
}

type MediaAnalyticsByToken = MediaAnalyticsSummary & {
	token: string
	feedId: string
	feedType: 'directory' | 'curated'
	firstSeenAt: number | null
	lastSeenAt: number | null
	feedName: string
	label: string
	createdAt: number | null
	lastUsedAt: number | null
	revokedAt: number | null
}

type MediaAnalyticsByFeed = MediaAnalyticsSummary & {
	feedId: string
	feedType: 'directory' | 'curated'
	firstSeenAt: number | null
	lastSeenAt: number | null
	feedName: string
}

type MediaAnalyticsDaily = MediaAnalyticsSummary & {
	day: string
	dayStart: number
}

type MediaTopClientAnalytics = MediaAnalyticsSummary & {
	clientName: string
	firstSeenAt: number | null
	lastSeenAt: number | null
}

type MediaAnalyticsResponse = {
	media: {
		rootName: string
		relativePath: string
	}
	windowDays: number
	since: number
	summary: MediaAnalyticsSummary
	byToken: Array<MediaAnalyticsByToken>
	byFeed: Array<MediaAnalyticsByFeed>
	topClients: Array<MediaTopClientAnalytics>
	daily: Array<MediaAnalyticsDaily>
}

type MediaAnalyticsLoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: MediaAnalyticsResponse }

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: MediaDetailResponse }

type EditableMetadata = {
	title: string
	author: string
	description: string
	date: string
	genre: string
	trackNumber: string
	copyright: string
	// Additional fields
	narrator: string
	album: string
	albumArtist: string
	composer: string
	publisher: string
	discNumber: string
	language: string
	series: string
	seriesPosition: string
	encodedBy: string
	subtitle: string
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
export function MediaDetail(handle: Handle) {
	let state: LoadingState = { status: 'loading' }
	let analyticsState: MediaAnalyticsLoadingState = { status: 'loading' }
	let analyticsRequestId = 0
	let analyticsWindowDays = 30
	let currentPath = ''
	let selectedFeedIds: Set<string> = new Set()
	let saving = false
	let saveMessage: { type: 'success' | 'error'; text: string } | null = null

	// Metadata editing state
	let isEditingMetadata = false
	let savingMetadata = false
	let metadataMessage: { type: 'success' | 'error'; text: string } | null = null
	let editedMetadata: EditableMetadata = {
		title: '',
		author: '',
		description: '',
		date: '',
		genre: '',
		trackNumber: '',
		copyright: '',
		// Additional fields
		narrator: '',
		album: '',
		albumArtist: '',
		composer: '',
		publisher: '',
		discNumber: '',
		language: '',
		series: '',
		seriesPosition: '',
		encodedBy: '',
		subtitle: '',
	}

	const fetchAnalytics = async (
		rootName: string,
		relativePath: string,
		windowDays: number,
	) => {
		analyticsRequestId += 1
		const requestId = analyticsRequestId
		analyticsState = { status: 'loading' }
		handle.update()

		try {
			const res = await fetch(
				`/admin/api/media-analytics/${encodeURIComponent(rootName)}/${encodeURIComponent(relativePath)}?days=${windowDays}`,
				{ signal: handle.signal },
			)

			if (!res.ok) {
				const data = await res.json().catch(() => ({}))
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			const data = (await res.json()) as MediaAnalyticsResponse
			if (requestId !== analyticsRequestId) return
			analyticsState = { status: 'success', data }
			handle.update()
		} catch (err) {
			if (handle.signal.aborted) return
			if (requestId !== analyticsRequestId) return
			analyticsState = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			handle.update()
		}
	}

	const fetchMedia = async (encodedPath: string) => {
		currentPath = encodedPath
		state = { status: 'loading' }
		analyticsState = { status: 'loading' }
		handle.update()

		try {
			const res = await fetch(`/admin/api/media/${encodedPath}`, {
				signal: handle.signal,
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

			fetchAnalytics(
				data.media.rootName,
				data.media.relativePath,
				analyticsWindowDays,
			)

			handle.update()
		} catch (err) {
			if (handle.signal.aborted) return
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error',
			}
			handle.update()
		}
	}

	const toggleFeed = (feedId: string) => {
		if (selectedFeedIds.has(feedId)) {
			selectedFeedIds.delete(feedId)
		} else {
			selectedFeedIds.add(feedId)
		}
		handle.update()
	}

	const saveAssignments = async () => {
		if (state.status !== 'success') return

		saving = true
		saveMessage = null
		handle.update()

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
			handle.update()

			// Clear success message after 3 seconds
			if (saveMessage?.type === 'success') {
				setTimeout(() => {
					saveMessage = null
					handle.update()
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

	// Initialize edit form with current metadata
	const startEditingMetadata = () => {
		if (state.status !== 'success') return
		const { media } = state.data
		// Extract date in YYYY-MM-DD format from ISO date string
		let dateValue = ''
		if (media.publicationDate) {
			try {
				const pubDate = new Date(media.publicationDate)
				// Check for invalid date before calling toISOString (which throws on invalid dates)
				if (!Number.isNaN(pubDate.getTime())) {
					// Format as YYYY-MM-DD for date input
					dateValue = pubDate.toISOString().split('T')[0] || ''
				}
			} catch {
				// If date parsing fails, leave dateValue empty
			}
		}
		editedMetadata = {
			title: media.title || '',
			author: media.author || '',
			description: media.description || '',
			date: dateValue,
			genre: media.genres?.join(', ') || '',
			trackNumber: media.trackNumber?.toString() || '',
			copyright: media.copyright || '',
			// Additional fields
			narrator: media.narrators?.join(', ') || '',
			album: media.album || '',
			albumArtist: media.albumArtist || '',
			composer: media.composer || '',
			publisher: media.publisher || '',
			discNumber: media.discNumber?.toString() || '',
			language: media.language || '',
			series: media.series || '',
			seriesPosition: media.seriesPosition || '',
			encodedBy: media.encodedBy || '',
			subtitle: media.subtitle || '',
		}
		isEditingMetadata = true
		metadataMessage = null
		handle.update()
	}

	const cancelEditingMetadata = () => {
		isEditingMetadata = false
		metadataMessage = null
		handle.update()
	}

	const saveMetadata = async () => {
		if (state.status !== 'success') return

		const savePath = currentPath
		savingMetadata = true
		metadataMessage = null
		handle.update()

		try {
			// Build the update payload with only changed fields
			const payload: Record<string, string | number> = {}

			if (editedMetadata.title) {
				payload.title = editedMetadata.title
			}
			if (editedMetadata.author) {
				payload.author = editedMetadata.author
			}
			if (editedMetadata.description) {
				payload.description = editedMetadata.description
			}
			if (editedMetadata.date) {
				// Date is already in YYYY-MM-DD format from the date input
				payload.date = editedMetadata.date
			}
			if (editedMetadata.genre) {
				payload.genre = editedMetadata.genre
			}
			if (editedMetadata.trackNumber) {
				const track = parseInt(editedMetadata.trackNumber, 10)
				if (!Number.isNaN(track)) {
					payload.trackNumber = track
				}
			}
			if (editedMetadata.copyright) {
				payload.copyright = editedMetadata.copyright
			}
			// Additional fields
			if (editedMetadata.narrator) {
				payload.narrator = editedMetadata.narrator
			}
			if (editedMetadata.album) {
				payload.album = editedMetadata.album
			}
			if (editedMetadata.albumArtist) {
				payload.albumArtist = editedMetadata.albumArtist
			}
			if (editedMetadata.composer) {
				payload.composer = editedMetadata.composer
			}
			if (editedMetadata.publisher) {
				payload.publisher = editedMetadata.publisher
			}
			if (editedMetadata.discNumber) {
				const disc = parseInt(editedMetadata.discNumber, 10)
				if (!Number.isNaN(disc)) {
					payload.discNumber = disc
				}
			}
			if (editedMetadata.language) {
				payload.language = editedMetadata.language
			}
			if (editedMetadata.series) {
				payload.series = editedMetadata.series
			}
			if (editedMetadata.seriesPosition) {
				payload.seriesPosition = editedMetadata.seriesPosition
			}
			if (editedMetadata.encodedBy) {
				payload.encodedBy = editedMetadata.encodedBy
			}
			if (editedMetadata.subtitle) {
				payload.subtitle = editedMetadata.subtitle
			}

			const res = await fetch(`/admin/api/media/${savePath}/metadata`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: handle.signal,
			})

			if (!res.ok) {
				const data = await res.json()
				throw new Error(data.error || `HTTP ${res.status}`)
			}

			// Don't update state if user navigated away
			if (handle.signal.aborted || currentPath !== savePath) return

			// Update state with the response
			const data = (await res.json()) as MediaDetailResponse
			state = { status: 'success', data }

			metadataMessage = { type: 'success', text: 'Metadata saved successfully' }
			isEditingMetadata = false

			// Clear success message after 3 seconds
			setTimeout(() => {
				metadataMessage = null
				handle.update()
			}, 3000)
		} catch (err) {
			// Ignore abort errors
			if (handle.signal.aborted) return
			metadataMessage = {
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to save metadata',
			}
		} finally {
			savingMetadata = false
			handle.update()
		}
	}

	const updateEditedField = (field: keyof EditableMetadata, value: string) => {
		editedMetadata[field] = value
		handle.update()
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
					{/* Left Column - Artwork & Metadata */}
					<div
						css={{
							// On mobile, show after the title/player section
							order: 1,
							[`@media (min-width: ${breakpoints.mobile})` as const]: {
								order: 0,
							},
						}}
					>
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
									...artworkLayout.centeredContain,
									display: 'block',
								}}
							/>
						</div>

						{/* Metadata Card - Below artwork on desktop */}
						<div
							css={{
								backgroundColor: colors.surface,
								borderRadius: radius.lg,
								border: `1px solid ${colors.border}`,
								padding: spacing.md,
								marginTop: spacing.md,
								boxShadow: shadows.sm,
							}}
						>
							<h3
								css={{
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: `0 0 ${spacing.sm} 0`,
								}}
							>
								Details
							</h3>

							<div
								css={{
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}}
							>
								<MetadataItem
									label="Duration"
									value={formatDuration(media.duration, { showSeconds: true })}
								/>
								<MetadataItem
									label="Size"
									value={formatFileSize(media.sizeBytes)}
								/>
								<MetadataItem label="Format" value={media.mimeType} />
								<MetadataItem
									label="Published"
									value={formatDate(media.publicationDate, { style: 'date' })}
								/>
								{media.album && (
									<MetadataItem label="Album" value={media.album} />
								)}
								{media.albumArtist && (
									<MetadataItem
										label="Album Artist"
										value={media.albumArtist}
									/>
								)}
								{media.trackNumber && (
									<MetadataItem
										label="Track"
										value={
											media.totalTracks
												? `${media.trackNumber} of ${media.totalTracks}`
												: `#${media.trackNumber}`
										}
									/>
								)}
								{media.discNumber && (
									<MetadataItem
										label="Disc"
										value={
											media.totalDiscs
												? `${media.discNumber} of ${media.totalDiscs}`
												: `#${media.discNumber}`
										}
									/>
								)}
								<MetadataItem
									label="Modified"
									value={new Date(
										media.fileModifiedAt * 1000,
									).toLocaleDateString()}
								/>
								{media.narrators && media.narrators.length > 0 && (
									<MetadataItem
										label="Narrators"
										value={media.narrators.join(', ')}
									/>
								)}
								{media.composer && (
									<MetadataItem label="Composer" value={media.composer} />
								)}
								{media.genres && media.genres.length > 0 && (
									<MetadataItem
										label="Genres"
										value={media.genres.join(', ')}
									/>
								)}
								{media.series && (
									<MetadataItem
										label="Series"
										value={
											media.seriesPosition
												? `${media.series} (${media.seriesPosition})`
												: media.series
										}
									/>
								)}
								{media.publisher && (
									<MetadataItem label="Publisher" value={media.publisher} />
								)}
								{media.language && (
									<MetadataItem label="Language" value={media.language} />
								)}
								{media.copyright && (
									<MetadataItem label="Copyright" value={media.copyright} />
								)}
								{media.encodedBy && (
									<MetadataItem label="Encoded By" value={media.encodedBy} />
								)}
								{media.subtitle && (
									<MetadataItem label="Subtitle" value={media.subtitle} />
								)}
							</div>

							{/* Description - Only shown on mobile */}
							{media.description && (
								<div
									css={{
										marginTop: spacing.md,
										[`@media (min-width: ${breakpoints.mobile})` as const]: {
											display: 'none',
										},
									}}
								>
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
							<div css={{ marginTop: spacing.md }}>
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
										fontSize: typography.fontSize.xs,
										color: colors.text,
										margin: 0,
										fontFamily: 'monospace',
										backgroundColor: colors.background,
										padding: spacing.xs,
										borderRadius: radius.sm,
										wordBreak: 'break-all',
									}}
								>
									{media.rootName}:{media.relativePath}
								</dd>
							</div>
						</div>
					</div>

					{/* Right Column - Title, Player, Description & Feeds */}
					<div
						css={{
							// On mobile, show first (before artwork/metadata)
							order: 0,
						}}
					>
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

						{/* Description Card - Hidden on mobile (shown in metadata card instead) */}
						{media.description && (
							<div
								css={{
									display: 'none',
									[`@media (min-width: ${breakpoints.mobile})` as const]: {
										display: 'block',
									},
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
									Description
								</h3>
								{/* TODO: Description may contain HTML. Render as HTML when Remix components support dangerouslySetInnerHTML */}
								<p
									css={{
										fontSize: typography.fontSize.sm,
										color: colors.text,
										margin: 0,
										lineHeight: 1.6,
										whiteSpace: 'pre-wrap',
									}}
								>
									{media.description}
								</p>
							</div>
						)}

						{/* Metadata Editing Card */}
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
									Edit Metadata
								</h3>
								{!isEditingMetadata && (
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
										on={{ click: startEditingMetadata }}
									>
										Edit
									</button>
								)}
							</div>

							{metadataMessage && !isEditingMetadata && (
								<div
									css={{
										padding: spacing.sm,
										borderRadius: radius.md,
										marginBottom: spacing.md,
										backgroundColor:
											metadataMessage.type === 'success'
												? 'rgba(16, 185, 129, 0.1)'
												: 'rgba(239, 68, 68, 0.1)',
										border: `1px solid ${metadataMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
									}}
								>
									<p
										css={{
											margin: 0,
											fontSize: typography.fontSize.sm,
											color:
												metadataMessage.type === 'success'
													? '#10b981'
													: '#ef4444',
										}}
									>
										{metadataMessage.text}
									</p>
								</div>
							)}

							{isEditingMetadata ? (
								<div>
									{metadataMessage && (
										<div
											css={{
												padding: spacing.sm,
												borderRadius: radius.md,
												marginBottom: spacing.md,
												backgroundColor:
													metadataMessage.type === 'success'
														? 'rgba(16, 185, 129, 0.1)'
														: 'rgba(239, 68, 68, 0.1)',
												border: `1px solid ${metadataMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
											}}
										>
											<p
												css={{
													margin: 0,
													fontSize: typography.fontSize.sm,
													color:
														metadataMessage.type === 'success'
															? '#10b981'
															: '#ef4444',
												}}
											>
												{metadataMessage.text}
											</p>
										</div>
									)}

									<div
										css={{
											display: 'flex',
											flexDirection: 'column',
											gap: spacing.md,
										}}
									>
										{/* Basic Info */}
										<MetadataField
											label="Title"
											value={editedMetadata.title}
											onChange={(v) => updateEditedField('title', v)}
										/>
										<MetadataField
											label="Subtitle"
											value={editedMetadata.subtitle}
											onChange={(v) => updateEditedField('subtitle', v)}
										/>
										<MetadataField
											label="Author / Artist"
											value={editedMetadata.author}
											onChange={(v) => updateEditedField('author', v)}
										/>
										<MetadataTextArea
											label="Description"
											value={editedMetadata.description}
											onChange={(v) => updateEditedField('description', v)}
										/>

										{/* Album Info */}
										<MetadataField
											label="Album"
											value={editedMetadata.album}
											onChange={(v) => updateEditedField('album', v)}
										/>
										<MetadataField
											label="Album Artist"
											value={editedMetadata.albumArtist}
											onChange={(v) => updateEditedField('albumArtist', v)}
										/>

										{/* Track/Disc Numbers */}
										<div
											css={{
												display: 'grid',
												gridTemplateColumns: '1fr 1fr',
												gap: spacing.md,
											}}
										>
											<MetadataField
												label="Track Number"
												value={editedMetadata.trackNumber}
												type="number"
												onChange={(v) => updateEditedField('trackNumber', v)}
											/>
											<MetadataField
												label="Disc Number"
												value={editedMetadata.discNumber}
												type="number"
												onChange={(v) => updateEditedField('discNumber', v)}
											/>
										</div>

										{/* People */}
										<MetadataField
											label="Narrator(s)"
											value={editedMetadata.narrator}
											onChange={(v) => updateEditedField('narrator', v)}
										/>
										<MetadataField
											label="Composer"
											value={editedMetadata.composer}
											onChange={(v) => updateEditedField('composer', v)}
										/>

										{/* Classification */}
										<MetadataField
											label="Genre"
											value={editedMetadata.genre}
											onChange={(v) => updateEditedField('genre', v)}
										/>
										<div
											css={{
												display: 'grid',
												gridTemplateColumns: '1fr 1fr',
												gap: spacing.md,
											}}
										>
											<MetadataField
												label="Publication Date"
												value={editedMetadata.date}
												type="date"
												onChange={(v) => updateEditedField('date', v)}
											/>
											<MetadataField
												label="Language"
												value={editedMetadata.language}
												onChange={(v) => updateEditedField('language', v)}
											/>
										</div>

										{/* Series Info */}
										<div
											css={{
												display: 'grid',
												gridTemplateColumns: '2fr 1fr',
												gap: spacing.md,
											}}
										>
											<MetadataField
												label="Series / Show"
												value={editedMetadata.series}
												onChange={(v) => updateEditedField('series', v)}
											/>
											<MetadataField
												label="Position"
												value={editedMetadata.seriesPosition}
												onChange={(v) => updateEditedField('seriesPosition', v)}
											/>
										</div>

										{/* Publishing Info */}
										<MetadataField
											label="Publisher"
											value={editedMetadata.publisher}
											onChange={(v) => updateEditedField('publisher', v)}
										/>
										<MetadataField
											label="Copyright"
											value={editedMetadata.copyright}
											onChange={(v) => updateEditedField('copyright', v)}
										/>
										<MetadataField
											label="Encoded By"
											value={editedMetadata.encodedBy}
											onChange={(v) => updateEditedField('encodedBy', v)}
										/>

										<div
											css={{
												display: 'flex',
												gap: spacing.sm,
												justifyContent: 'flex-end',
												marginTop: spacing.sm,
											}}
										>
											<button
												type="button"
												disabled={savingMetadata}
												css={{
													padding: `${spacing.sm} ${spacing.lg}`,
													fontSize: typography.fontSize.sm,
													fontWeight: typography.fontWeight.medium,
													color: colors.text,
													backgroundColor: colors.background,
													border: `1px solid ${colors.border}`,
													borderRadius: radius.md,
													cursor: savingMetadata ? 'not-allowed' : 'pointer',
													transition: `all ${transitions.fast}`,
													'&:hover': savingMetadata
														? {}
														: { backgroundColor: colors.surface },
												}}
												on={{ click: cancelEditingMetadata }}
											>
												Cancel
											</button>
											<button
												type="button"
												disabled={savingMetadata}
												css={{
													padding: `${spacing.sm} ${spacing.lg}`,
													fontSize: typography.fontSize.sm,
													fontWeight: typography.fontWeight.medium,
													color: colors.background,
													backgroundColor: savingMetadata
														? colors.border
														: colors.primary,
													border: 'none',
													borderRadius: radius.md,
													cursor: savingMetadata ? 'not-allowed' : 'pointer',
													transition: `all ${transitions.fast}`,
													'&:hover': savingMetadata
														? {}
														: { backgroundColor: colors.primaryHover },
												}}
												on={{ click: saveMetadata }}
											>
												{savingMetadata ? 'Saving...' : 'Save Metadata'}
											</button>
										</div>
									</div>
								</div>
							) : (
								<p
									css={{
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										margin: 0,
									}}
								>
									Edit the file's embedded metadata (title, author, description,
									etc.)
								</p>
							)}
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
										{curatedFeeds.map((feed) => {
											const isEnabled = selectedFeedIds.has(feed.id)
											return (
												<div
													key={feed.id}
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
														src={`/admin/api/feeds/${feed.id}/artwork?t=${feed.updatedAt}`}
														alt=""
														css={{
															width: '32px',
															height: '32px',
															borderRadius: radius.sm,
															...artworkLayout.centeredContain,
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
													<button
														type="button"
														role="switch"
														aria-checked={isEnabled}
														css={{
															width: '44px',
															height: '24px',
															borderRadius: '12px',
															border: 'none',
															backgroundColor: isEnabled
																? colors.primary
																: colors.border,
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
														on={{ click: () => toggleFeed(feed.id) }}
													>
														<div
															css={{
																width: '20px',
																height: '20px',
																borderRadius: '50%',
																backgroundColor: '#fff',
																boxShadow: shadows.sm,
																transition: `transform ${transitions.fast}`,
																transform: isEnabled
																	? 'translateX(20px)'
																	: 'translateX(0)',
															}}
														/>
													</button>
												</div>
											)
										})}
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
															...artworkLayout.centeredContain,
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

						{/* Media Analytics Card */}
						<div
							css={{
								backgroundColor: colors.surface,
								borderRadius: radius.lg,
								border: `1px solid ${colors.border}`,
								padding: responsive.spacingSection,
								marginTop: spacing.xl,
								boxShadow: shadows.sm,
							}}
						>
							<div
								css={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: spacing.sm,
									marginBottom: spacing.md,
									flexWrap: 'wrap',
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
									Analytics (last {analyticsWindowDays} days)
								</h3>
								<div css={{ display: 'flex', gap: spacing.xs }}>
									{[7, 30, 90].map((days) => (
										<button
											key={days}
											type="button"
											css={{
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
											}}
											on={{
												click: () => {
													if (
														days === analyticsWindowDays ||
														state.status !== 'success'
													) {
														return
													}
													analyticsWindowDays = days
													fetchAnalytics(
														state.data.media.rootName,
														state.data.media.relativePath,
														days,
													)
												},
											}}
										>
											{days}d
										</button>
									))}
								</div>
							</div>
							<MediaAnalyticsSection analyticsState={analyticsState} />
						</div>
					</div>
				</div>
			</div>
		)
	}
}

function LoadingSpinner() {
	return () => (
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

function ErrorMessage() {
	return ({ message }: { message: string }) => (
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

function MetadataItem() {
	return ({ label, value }: { label: string; value: string }) => (
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

function MediaAnalyticsSection() {
	return ({
		analyticsState,
	}: {
		analyticsState: MediaAnalyticsLoadingState
	}) => {
		if (analyticsState.status === 'loading') {
			return (
				<p
					css={{
						margin: 0,
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
					}}
				>
					Loading analytics...
				</p>
			)
		}

		if (analyticsState.status === 'error') {
			return (
				<p
					css={{
						margin: 0,
						fontSize: typography.fontSize.sm,
						color: '#ef4444',
					}}
				>
					Unable to load analytics: {analyticsState.message}
				</p>
			)
		}

		const { summary, byFeed, byToken, topClients, daily } = analyticsState.data
		return (
			<div
				css={{
					display: 'flex',
					flexDirection: 'column',
					gap: spacing.lg,
				}}
			>
				<div
					css={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
						gap: spacing.sm,
					}}
				>
					<AnalyticsMetricCard
						label="Requests"
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

				<div
					css={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
						gap: spacing.lg,
					}}
				>
					<div>
						<h4
							css={{
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.semibold,
								margin: `0 0 ${spacing.sm} 0`,
								color: colors.text,
							}}
						>
							By Feed
						</h4>
						{byFeed.length === 0 ? (
							<p
								css={{
									margin: 0,
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
								}}
							>
								No feed-level analytics yet.
							</p>
						) : (
							<ul
								css={{
									listStyle: 'none',
									padding: 0,
									margin: 0,
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}}
							>
								{byFeed.map((feed) => (
									<li
										key={`${feed.feedType}-${feed.feedId}`}
										css={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											backgroundColor: colors.background,
										}}
									>
										<Link
											href={`/admin/feeds/${feed.feedId}`}
											css={{
												color: colors.primary,
												textDecoration: 'none',
												fontSize: typography.fontSize.sm,
												fontWeight: typography.fontWeight.medium,
											}}
										>
											{feed.feedName}
										</Link>
										<div
											css={{
												fontSize: typography.fontSize.xs,
												color: colors.textMuted,
												display: 'flex',
												gap: spacing.sm,
												marginTop: spacing.xs,
												flexWrap: 'wrap',
											}}
										>
											<span>{feed.downloadStarts} starts</span>
											<span>{feed.mediaRequests} requests</span>
											<span>{formatFileSize(feed.bytesServed)}</span>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<div>
						<h4
							css={{
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.semibold,
								margin: `0 0 ${spacing.sm} 0`,
								color: colors.text,
							}}
						>
							Top Tokens
						</h4>
						{byToken.length === 0 ? (
							<p
								css={{
									margin: 0,
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
								}}
							>
								No token-level analytics yet.
							</p>
						) : (
							<ul
								css={{
									listStyle: 'none',
									padding: 0,
									margin: 0,
									display: 'flex',
									flexDirection: 'column',
									gap: spacing.sm,
								}}
							>
								{byToken.slice(0, 8).map((token) => (
									<li
										key={`${token.feedType}-${token.feedId}-${token.token}`}
										css={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											backgroundColor: colors.background,
										}}
									>
										<div
											css={{
												fontSize: typography.fontSize.sm,
												color: colors.text,
												fontWeight: typography.fontWeight.medium,
											}}
										>
											{token.label || 'Unlabeled token'}
										</div>
										<div
											css={{
												fontSize: typography.fontSize.xs,
												color: colors.textMuted,
												marginTop: spacing.xs,
												display: 'flex',
												gap: spacing.sm,
												flexWrap: 'wrap',
											}}
										>
											<span>{token.downloadStarts} starts</span>
											<span>{token.mediaRequests} requests</span>
											<span>{token.uniqueClients} clients</span>
											<span>{formatRelativeTime(token.lastSeenAt)}</span>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				<AnalyticsTopClientsList clients={topClients} />

				<AnalyticsDailyActivityChart daily={daily} />
			</div>
		)
	}
}

function MetadataField() {
	return ({
		label,
		value,
		type = 'text',
		onChange,
	}: {
		label: string
		value: string
		type?: 'text' | 'number' | 'date'
		onChange: (value: string) => void
	}) => {
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
		}

		const labelStyles = {
			display: 'block',
			fontSize: typography.fontSize.xs,
			color: colors.textMuted,
			textTransform: 'uppercase' as const,
			letterSpacing: '0.05em',
			marginBottom: spacing.xs,
		}

		const inputHandler = {
			input: (e: Event) => onChange((e.target as HTMLInputElement).value),
		}

		if (type === 'number') {
			return (
				<div>
					<label css={{ display: 'block' }}>
						<span css={labelStyles}>{label}</span>
						<input
							type="number"
							value={value}
							css={inputStyles}
							on={inputHandler}
						/>
					</label>
				</div>
			)
		}

		if (type === 'date') {
			return (
				<div>
					<label css={{ display: 'block' }}>
						<span css={labelStyles}>{label}</span>
						<input
							type="date"
							value={value}
							css={inputStyles}
							on={{
								change: (e: Event) =>
									onChange((e.target as HTMLInputElement).value),
							}}
						/>
					</label>
				</div>
			)
		}

		return (
			<div>
				<label css={{ display: 'block' }}>
					<span css={labelStyles}>{label}</span>
					<input
						type="text"
						value={value}
						list={undefined}
						css={inputStyles}
						on={inputHandler}
					/>
				</label>
			</div>
		)
	}
}

function MetadataTextArea() {
	return ({
		label,
		value,
		onChange,
	}: {
		label: string
		value: string
		onChange: (value: string) => void
	}) => (
		<div>
			<label
				css={{
					display: 'block',
				}}
			>
				<span
					css={{
						display: 'block',
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						marginBottom: spacing.xs,
					}}
				>
					{label}
				</span>
				<textarea
					value={value}
					rows={4}
					css={{
						width: '100%',
						padding: spacing.sm,
						fontSize: typography.fontSize.sm,
						color: colors.text,
						backgroundColor: colors.background,
						border: `1px solid ${colors.border}`,
						borderRadius: radius.md,
						outline: 'none',
						resize: 'vertical',
						fontFamily: 'inherit',
						transition: `border-color ${transitions.fast}`,
						'&:focus': {
							borderColor: colors.primary,
						},
					}}
					on={{
						input: (e) => onChange((e.target as HTMLTextAreaElement).value),
					}}
				/>
			</label>
		</div>
	)
}
