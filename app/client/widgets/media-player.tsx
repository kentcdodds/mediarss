/**
 * Media Player Widget for MCP-UI
 *
 * A self-contained media player widget that displays media information
 * and provides playback controls. Designed to work within ChatGPT's
 * MCP-UI context.
 *
 * Data is received via the MCP-UI initial-render-data protocol,
 * not embedded inline in the HTML.
 */
import { createRoot, type Handle } from '@remix-run/component'
import { z } from 'zod'
import { initMcpUi, waitForRenderData } from './mcp-ui.ts'

/**
 * Media data schema for validation
 */
const MediaDataSchema = z.object({
	title: z.string(),
	author: z.string().nullable(),
	duration: z.number().nullable(),
	sizeBytes: z.number(),
	mimeType: z.string(),
	publicationDate: z.string().nullable(),
	description: z.string().nullable(),
	narrators: z.array(z.string()).nullable(),
	genres: z.array(z.string()).nullable(),
	artworkUrl: z.string(),
	streamUrl: z.string(),
})

type MediaData = z.infer<typeof MediaDataSchema>

/**
 * Render data schema from MCP-UI protocol
 * ChatGPT wraps the data in toolInput/toolOutput
 */
const RenderDataSchema = z
	.object({
		toolInput: MediaDataSchema.passthrough().nullable(),
		toolOutput: z.object({}).passthrough().nullable(),
	})
	.passthrough()

// Color tokens for the widget (dark theme optimized for ChatGPT context)
const colors = {
	background: '#0a0a0a',
	surface: '#141414',
	surfaceHover: '#1a1a1a',
	text: '#f9f9f9',
	textMuted: '#a3a3a3',
	border: '#2a2a2a',
	primary: '#fbbf24',
	primaryHover: '#f59e0b',
}

const spacing = {
	xs: '0.25rem',
	sm: '0.5rem',
	md: '1rem',
	lg: '1.5rem',
	xl: '2rem',
}

const typography = {
	fontFamily: 'system-ui, -apple-system, sans-serif',
	xs: '0.75rem',
	sm: '0.875rem',
	base: '1rem',
	lg: '1.25rem',
	xl: '1.5rem',
	'2xl': '2rem',
}

const radius = {
	sm: '0.25rem',
	md: '0.5rem',
	lg: '0.75rem',
}

/**
 * Format duration in seconds to human-readable format.
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
 * Format file size in bytes to human-readable format.
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
 * Format a date to a readable string.
 */
function formatDate(dateStr: string | null): string {
	if (!dateStr) return '—'

	try {
		const date = new Date(dateStr)
		if (Number.isNaN(date.getTime())) return '—'

		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		})
	} catch {
		return '—'
	}
}

/**
 * Check if MIME type is video
 */
function isVideo(mimeType: string): boolean {
	return mimeType.startsWith('video/')
}

/**
 * Metadata item display component
 */
function MetadataItem({ label, value }: { label: string; value: string }) {
	return (
		<div
			css={{
				display: 'flex',
				flexDirection: 'column',
				gap: spacing.xs,
			}}
		>
			<span
				css={{
					fontSize: typography.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
				}}
			>
				{label}
			</span>
			<span
				css={{
					fontSize: typography.sm,
					color: colors.text,
				}}
			>
				{value}
			</span>
		</div>
	)
}

/**
 * Loading state component
 */
function LoadingState() {
	return (
		<div
			css={{
				fontFamily: typography.fontFamily,
				backgroundColor: colors.background,
				color: colors.text,
				minHeight: '100vh',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				padding: spacing.xl,
			}}
		>
			<div
				css={{
					fontSize: typography.lg,
					color: colors.textMuted,
					marginBottom: spacing.md,
				}}
			>
				Loading media player...
			</div>
		</div>
	)
}

/**
 * Error state component
 */
function ErrorState({ message }: { message: string }) {
	return (
		<div
			css={{
				fontFamily: typography.fontFamily,
				backgroundColor: colors.background,
				color: colors.text,
				minHeight: '100vh',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				padding: spacing.xl,
				textAlign: 'center',
			}}
		>
			<div
				css={{
					fontSize: typography.lg,
					color: '#ef4444',
					marginBottom: spacing.md,
				}}
			>
				Error loading media
			</div>
			<div
				css={{
					fontSize: typography.sm,
					color: colors.textMuted,
				}}
			>
				{message}
			</div>
		</div>
	)
}

/**
 * Media player content component
 */
function MediaPlayerContent({ media }: { media: MediaData }) {
	const isVideoFile = isVideo(media.mimeType)

	return (
		<div
			css={{
				fontFamily: typography.fontFamily,
				backgroundColor: colors.background,
				color: colors.text,
				minHeight: '100vh',
				padding: spacing.lg,
			}}
		>
			{/* Main container */}
			<div
				css={{
					maxWidth: '800px',
					margin: '0 auto',
				}}
			>
				{/* Header with artwork and title */}
				<div
					css={{
						display: 'flex',
						gap: spacing.lg,
						marginBottom: spacing.xl,
						'@media (max-width: 640px)': {
							flexDirection: 'column',
							alignItems: 'center',
							textAlign: 'center',
						},
					}}
				>
					{/* Artwork */}
					<div
						css={{
							width: '200px',
							height: '200px',
							flexShrink: 0,
							borderRadius: radius.lg,
							overflow: 'hidden',
							backgroundColor: colors.surface,
							border: `1px solid ${colors.border}`,
							boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
						}}
					>
						<img
							src={media.artworkUrl}
							alt={media.title}
							css={{
								width: '100%',
								height: '100%',
								objectFit: 'cover',
							}}
						/>
					</div>

					{/* Title and author */}
					<div
						css={{
							flex: 1,
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'center',
							minWidth: 0,
						}}
					>
						<h1
							css={{
								fontSize: typography['2xl'],
								fontWeight: 700,
								color: colors.text,
								margin: 0,
								lineHeight: 1.2,
								wordBreak: 'break-word',
								'@media (max-width: 640px)': {
									fontSize: typography.xl,
								},
							}}
						>
							{media.title}
						</h1>
						{media.author && (
							<p
								css={{
									fontSize: typography.lg,
									color: colors.textMuted,
									margin: `${spacing.sm} 0 0 0`,
								}}
							>
								by {media.author}
							</p>
						)}
						{media.narrators && media.narrators.length > 0 && (
							<p
								css={{
									fontSize: typography.sm,
									color: colors.textMuted,
									margin: `${spacing.xs} 0 0 0`,
								}}
							>
								Narrated by {media.narrators.join(', ')}
							</p>
						)}
					</div>
				</div>

				{/* Media Player */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: spacing.md,
						marginBottom: spacing.xl,
					}}
				>
					{isVideoFile ? (
						// biome-ignore lint/a11y/useMediaCaption: Media files don't include caption tracks
						<video
							src={media.streamUrl}
							controls
							preload="metadata"
							css={{
								width: '100%',
								borderRadius: radius.md,
								backgroundColor: '#000',
							}}
						>
							Your browser does not support video playback.
						</video>
					) : (
						// biome-ignore lint/a11y/useMediaCaption: Media files don't include caption tracks
						<audio
							src={media.streamUrl}
							controls
							preload="metadata"
							css={{
								width: '100%',
							}}
						>
							Your browser does not support audio playback.
						</audio>
					)}
				</div>

				{/* Description */}
				{media.description && (
					<div
						css={{
							backgroundColor: colors.surface,
							borderRadius: radius.lg,
							border: `1px solid ${colors.border}`,
							padding: spacing.lg,
							marginBottom: spacing.xl,
						}}
					>
						<h2
							css={{
								fontSize: typography.base,
								fontWeight: 600,
								color: colors.text,
								margin: `0 0 ${spacing.md} 0`,
							}}
						>
							Description
						</h2>
						<p
							css={{
								fontSize: typography.sm,
								color: colors.text,
								margin: 0,
								lineHeight: 1.7,
								whiteSpace: 'pre-wrap',
							}}
						>
							{media.description}
						</p>
					</div>
				)}

				{/* Metadata Grid */}
				<div
					css={{
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						padding: spacing.lg,
					}}
				>
					<h2
						css={{
							fontSize: typography.base,
							fontWeight: 600,
							color: colors.text,
							margin: `0 0 ${spacing.md} 0`,
						}}
					>
						Details
					</h2>
					<div
						css={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
							gap: spacing.lg,
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
						{media.genres && media.genres.length > 0 && (
							<MetadataItem label="Genres" value={media.genres.join(', ')} />
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

/**
 * Media Player Widget App Component
 *
 * Handles the lifecycle:
 * 1. Signal ready to parent via initMcpUi
 * 2. Wait for render data via waitForRenderData
 * 3. Display loading, error, or content based on state
 */
function MediaPlayerApp(this: Handle) {
	let state: 'loading' | 'ready' | 'error' = 'loading'
	let media: MediaData | null = null
	let errorMessage = ''

	// Request render data from parent frame
	void waitForRenderData(RenderDataSchema)
		.then((renderData) => {
			console.log('[MediaPlayer] Received render data:', renderData)

			// Extract media from toolInput (ChatGPT wraps data this way)
			const mediaData = renderData.toolInput
			if (!mediaData) {
				state = 'error'
				errorMessage = 'No media data received'
				this.update()
				return
			}

			media = mediaData
			state = 'ready'
			this.update()
		})
		.catch((err) => {
			console.error('[MediaPlayer] Error receiving render data:', err)
			state = 'error'
			errorMessage = err instanceof Error ? err.message : 'Unknown error'
			this.update()
		})

	return () => {
		if (state === 'loading') {
			return <LoadingState />
		}

		if (state === 'error') {
			return <ErrorState message={errorMessage} />
		}

		if (!media) {
			return <ErrorState message="No media data available" />
		}

		return <MediaPlayerContent media={media} />
	}
}

// Mount the widget
const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(
	<div
		connect={() => {
			// Signal to parent that the widget is ready when mounted
			initMcpUi()
		}}
	>
		<MediaPlayerApp />
	</div>,
)
