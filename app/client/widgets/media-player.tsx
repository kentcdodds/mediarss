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
import { waitForRenderData } from './mcp-ui.ts'

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * The widget's required input schema - this is what the widget renders.
 * DO NOT CHANGE THIS SCHEMA - the adapter must conform to it.
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
 * Schema for the MediaRSS tool's structured output.
 * This is what the tool returns in structuredContent.
 */
const ToolOutputSchema = z.object({
	metadata: z.object({
		title: z.string(),
		author: z.string().nullable(),
		duration: z.number().nullable(),
		sizeBytes: z.number(),
		mimeType: z.string(),
		publicationDate: z.string().nullable(),
		description: z.string().nullable(),
		narrators: z.array(z.string()).nullable(),
		genres: z.array(z.string()).nullable(),
	}),
	access: z.object({
		token: z.string(),
		mediaRoot: z.string(),
		relativePath: z.string(),
	}),
})

type ToolOutput = z.infer<typeof ToolOutputSchema>

/**
 * Render data schema from MCP-UI protocol.
 * ChatGPT provides toolInput (tool's input params) and toolOutput (tool's result).
 */
const RenderDataSchema = z
	.object({
		toolInput: z.unknown().nullable(),
		toolOutput: z.unknown().nullable(),
	})
	.passthrough()

// =============================================================================
// ADAPTER LAYER
// =============================================================================

/**
 * Encode a relative path for use in URLs.
 * Handles special characters properly.
 */
function encodeRelativePath(path: string): string {
	return path
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')
}

/**
 * Derive the artwork URL from access info.
 * Uses the /art/:token/:path endpoint.
 */
function deriveArtworkUrl(access: ToolOutput['access']): string {
	const encodedPath = encodeRelativePath(
		`${access.mediaRoot}/${access.relativePath}`,
	)
	return `/art/${access.token}/${encodedPath}`
}

/**
 * Derive the stream URL from access info.
 * Uses the /media/:token/:path endpoint.
 */
function deriveStreamUrl(access: ToolOutput['access']): string {
	const encodedPath = encodeRelativePath(
		`${access.mediaRoot}/${access.relativePath}`,
	)
	return `/media/${access.token}/${encodedPath}`
}

/**
 * Adapter: Maps the MediaRSS tool output to the widget's expected MediaData format.
 *
 * This is the explicit adapter layer that transforms:
 *   { metadata: {...}, access: {...} }
 * into:
 *   { title, author, ..., artworkUrl, streamUrl }
 *
 * @throws Error if the input doesn't match the expected tool output shape
 */
function adaptToolOutputToMediaData(toolOutput: unknown): MediaData {
	// Parse and validate the tool output structure
	const parsed = ToolOutputSchema.parse(toolOutput)

	// Map metadata fields directly and derive URLs from access
	const adapted: MediaData = {
		title: parsed.metadata.title,
		author: parsed.metadata.author,
		duration: parsed.metadata.duration,
		sizeBytes: parsed.metadata.sizeBytes,
		mimeType: parsed.metadata.mimeType,
		publicationDate: parsed.metadata.publicationDate,
		description: parsed.metadata.description,
		narrators: parsed.metadata.narrators,
		genres: parsed.metadata.genres,
		artworkUrl: deriveArtworkUrl(parsed.access),
		streamUrl: deriveStreamUrl(parsed.access),
	}

	// Runtime validation: ensure all required fields are present
	// This will throw if any field is missing, making regressions impossible to miss
	return MediaDataSchema.parse(adapted)
}

/**
 * Check if data matches the full MediaData schema (already adapted or from initial-render-data).
 */
function isFullMediaData(data: unknown): data is MediaData {
	return MediaDataSchema.safeParse(data).success
}

/**
 * Check if data matches the tool output schema (needs adaptation).
 */
function isToolOutput(data: unknown): data is ToolOutput {
	return ToolOutputSchema.safeParse(data).success
}

/**
 * Schema for minimal input (path params from toolInput when toolOutput is unavailable).
 */
const MinimalInputSchema = z.object({
	mediaRoot: z.string(),
	relativePath: z.string(),
	token: z.string().optional(),
})

/**
 * Check if data is minimal path input.
 */
function isMinimalInput(
	data: unknown,
): data is z.infer<typeof MinimalInputSchema> {
	return MinimalInputSchema.safeParse(data).success
}

/**
 * Fetch media data from the server API when toolOutput is unavailable.
 * This is a fallback for when ChatGPT doesn't populate toolOutput.
 */
async function fetchMediaDataFromApi(
	mediaRoot: string,
	relativePath: string,
	token?: string,
): Promise<MediaData> {
	const response = await fetch('/mcp/widget/media-data', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mediaRoot, relativePath, token }),
	})

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}))
		throw new Error(
			(errorData as { error?: string }).error ||
				`Failed to fetch media data: ${response.status}`,
		)
	}

	const data = await response.json()
	return MediaDataSchema.parse(data)
}

/**
 * Extract and adapt media data from render data.
 *
 * Handles multiple input scenarios in priority order:
 * 1. toolOutput contains { metadata, access } → adapt it
 * 2. toolOutput contains full MediaData → use directly
 * 3. toolInput contains full MediaData (initial-render-data passthrough) → use directly
 * 4. toolInput contains { metadata, access } → adapt it
 * 5. toolInput contains minimal path params → fetch from API (fallback)
 *
 * @throws Error with descriptive message if no valid data source is found
 */
async function extractMediaData(
	renderData: z.infer<typeof RenderDataSchema>,
): Promise<MediaData> {
	const { toolInput, toolOutput } = renderData

	// Priority 1: toolOutput with metadata + access (standard ChatGPT flow)
	if (toolOutput && isToolOutput(toolOutput)) {
		console.log('[MediaPlayer] Adapting toolOutput to MediaData')
		return adaptToolOutputToMediaData(toolOutput)
	}

	// Priority 2: toolOutput already has full MediaData
	if (toolOutput && isFullMediaData(toolOutput)) {
		console.log('[MediaPlayer] Using toolOutput as MediaData directly')
		return toolOutput
	}

	// Priority 3: toolInput has full MediaData (initial-render-data passthrough)
	if (toolInput && isFullMediaData(toolInput)) {
		console.log('[MediaPlayer] Using toolInput as MediaData directly')
		return toolInput
	}

	// Priority 4: toolInput has metadata + access
	if (toolInput && isToolOutput(toolInput)) {
		console.log('[MediaPlayer] Adapting toolInput to MediaData')
		return adaptToolOutputToMediaData(toolInput)
	}

	// Priority 5: toolInput has minimal path params - fetch from API
	// This is a fallback for when ChatGPT doesn't populate toolOutput
	if (toolInput && isMinimalInput(toolInput)) {
		console.log(
			'[MediaPlayer] toolOutput unavailable, fetching from API using toolInput path params',
		)
		return fetchMediaDataFromApi(
			toolInput.mediaRoot,
			toolInput.relativePath,
			toolInput.token,
		)
	}

	// No valid data source found - provide detailed error
	const availableData = {
		hasToolInput: toolInput !== null && toolInput !== undefined,
		hasToolOutput: toolOutput !== null && toolOutput !== undefined,
		toolInputKeys:
			toolInput && typeof toolInput === 'object'
				? Object.keys(toolInput as object)
				: [],
		toolOutputKeys:
			toolOutput && typeof toolOutput === 'object'
				? Object.keys(toolOutput as object)
				: [],
	}

	throw new Error(
		`No valid media data found in renderData. ` +
			`Expected toolOutput with {metadata, access} or full MediaData. ` +
			`Available: ${JSON.stringify(availableData)}`,
	)
}

// =============================================================================
// UI COMPONENTS
// =============================================================================

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

function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B'

	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	const k = 1024
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	const size = bytes / Math.pow(k, i)

	return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

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

function isVideo(mimeType: string): boolean {
	return mimeType.startsWith('video/')
}

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

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================

/**
 * Media Player Widget App Component
 *
 * Handles the lifecycle:
 * 1. Wait for render data via waitForRenderData (also signals readiness)
 * 2. Use adapter to extract and transform media data from toolOutput
 * 3. Display loading, error, or content based on state
 */
function MediaPlayerApp(this: Handle) {
	let state: 'loading' | 'ready' | 'error' = 'loading'
	let media: MediaData | null = null
	let errorMessage = ''

	// Request render data from parent frame
	void waitForRenderData(RenderDataSchema)
		.then(async (renderData) => {
			console.log('[MediaPlayer] Received render data:', renderData)

			// Use the adapter to extract and transform media data
			media = await extractMediaData(renderData)
			state = 'ready'
			this.update()
		})
		.catch((err) => {
			console.error('[MediaPlayer] Error receiving render data:', err)
			state = 'error'
			if (err instanceof Error) {
				errorMessage = err.message
			} else if (typeof err === 'string') {
				errorMessage = err
			} else if (err && typeof err === 'object' && 'message' in err) {
				errorMessage = String(err.message)
			} else {
				errorMessage = 'Unknown error'
			}
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
createRoot(rootElement).render(<MediaPlayerApp />)
