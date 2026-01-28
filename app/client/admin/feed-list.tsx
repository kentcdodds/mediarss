import { matchSorter, rankings } from 'match-sorter'
import type { Handle } from 'remix/component'
import { SearchInput } from '#app/components/search-input.tsx'
import { formatRelativeTime } from '#app/helpers/format.ts'
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
import { Link } from './router.tsx'

type DirectoryFeed = {
	id: string
	name: string
	description: string
	directoryPaths: string // JSON array of paths
	tokenCount: number
	itemCount: number
	lastAccessedAt: number | null
	type: 'directory'
	createdAt: number
	imageUrl: string | null
}

type CuratedFeed = {
	id: string
	name: string
	description: string
	tokenCount: number
	itemCount: number
	lastAccessedAt: number | null
	type: 'curated'
	createdAt: number
	imageUrl: string | null
}

type FilterType = 'all' | 'directory' | 'curated'

type Feed = DirectoryFeed | CuratedFeed

type FeedsResponse = {
	directoryFeeds: Array<DirectoryFeed>
	curatedFeeds: Array<CuratedFeed>
}

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; feeds: Array<Feed> }

/**
 * FeedList component - displays all feeds in a card grid.
 */
export function FeedList(handle: Handle) {
	let state: LoadingState = { status: 'loading' }
	let searchQuery = ''
	let filterType: FilterType = 'all'

	// Fetch feeds on mount
	fetch('/admin/api/feeds', { signal: handle.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<FeedsResponse>
		})
		.then((data) => {
			// Combine and sort by creation date (newest first)
			const allFeeds: Array<Feed> = [
				...data.directoryFeeds,
				...data.curatedFeeds,
			].sort((a, b) => b.createdAt - a.createdAt)

			state = { status: 'success', feeds: allFeeds }
			handle.update()
		})
		.catch((err) => {
			if (handle.signal.aborted) return
			state = { status: 'error', message: err.message }
			handle.update()
		})

	return () => {
		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		if (state.status === 'error') {
			return <ErrorMessage message={state.message} />
		}

		const { feeds } = state

		// Filter feeds by type
		const typeFilteredFeeds =
			filterType === 'all'
				? feeds
				: feeds.filter((feed) => feed.type === filterType)

		// Filter feeds by search query using match-sorter
		const filteredFeeds = searchQuery.trim()
			? matchSorter(typeFilteredFeeds, searchQuery.trim(), {
					keys: [
						// Name is the primary search field
						{ key: 'name', threshold: rankings.CONTAINS },
						// Description for content-based search
						{ key: 'description', threshold: rankings.CONTAINS },
						// Type (directory/curated)
						{ key: 'type', threshold: rankings.WORD_STARTS_WITH },
						// Directory paths for directory feeds
						{
							key: (feed) => {
								if (feed.type === 'directory') {
									return parseDirectoryPaths(
										(feed as DirectoryFeed).directoryPaths,
									).join(' ')
								}
								return ''
							},
							threshold: rankings.CONTAINS,
							maxRanking: rankings.CONTAINS,
						},
					],
				})
			: typeFilteredFeeds

		return (
			<div>
				<div
					css={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						marginBottom: spacing.xl,
						flexWrap: 'wrap',
						gap: spacing.md,
						[mq.mobile]: {
							flexDirection: 'column',
							alignItems: 'stretch',
						},
					}}
				>
					<div>
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
							Your Feeds
						</h2>
						{feeds.length > 0 && (
							<p
								css={{
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									margin: `${spacing.xs} 0 0 0`,
								}}
							>
								{filteredFeeds.length === feeds.length
									? `${feeds.length} feed${feeds.length !== 1 ? 's' : ''}`
									: `Showing ${filteredFeeds.length} of ${feeds.length} feeds`}
							</p>
						)}
					</div>

					{/* Type Filter */}
					{feeds.length > 0 && (
						<div
							css={{
								display: 'flex',
								gap: spacing.xs,
								[mq.mobile]: {
									width: '100%',
									justifyContent: 'center',
								},
							}}
						>
							<FilterButton
								active={filterType === 'all'}
								onClick={() => {
									filterType = 'all'
									handle.update()
								}}
							>
								All
							</FilterButton>
							<FilterButton
								active={filterType === 'directory'}
								onClick={() => {
									filterType = 'directory'
									handle.update()
								}}
								color="#3b82f6"
							>
								Directory
							</FilterButton>
							<FilterButton
								active={filterType === 'curated'}
								onClick={() => {
									filterType = 'curated'
									handle.update()
								}}
								color="#8b5cf6"
							>
								Curated
							</FilterButton>
						</div>
					)}
					<div
						css={{
							display: 'flex',
							gap: spacing.sm,
							[mq.mobile]: {
								flexDirection: 'column',
							},
						}}
					>
						<Link
							href="/admin/media"
							css={{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: spacing.sm,
								padding: `${spacing.sm} ${spacing.lg}`,
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.primary,
								backgroundColor: 'transparent',
								border: `1px solid ${colors.primary}`,
								borderRadius: radius.md,
								textDecoration: 'none',
								cursor: 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover': {
									backgroundColor: colors.primarySoft,
								},
							}}
						>
							Manage Access
						</Link>
						<Link
							href="/admin/feeds/new"
							css={{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: spacing.sm,
								padding: `${spacing.sm} ${spacing.lg}`,
								fontSize: typography.fontSize.sm,
								fontWeight: typography.fontWeight.medium,
								color: colors.background,
								backgroundColor: colors.primary,
								border: 'none',
								borderRadius: radius.md,
								textDecoration: 'none',
								cursor: 'pointer',
								transition: `all ${transitions.fast}`,
								'&:hover': {
									backgroundColor: colors.primaryHover,
								},
							}}
						>
							+ New Feed
						</Link>
					</div>
				</div>

				{/* Search */}
				{feeds.length > 0 && (
					<div css={{ marginBottom: spacing.lg }}>
						<SearchInput
							placeholder="Search by name, description, path..."
							value={searchQuery}
							onInput={(value) => {
								searchQuery = value
								handle.update()
							}}
							onClear={() => {
								searchQuery = ''
								handle.update()
							}}
						/>
					</div>
				)}

				{feeds.length === 0 ? (
					<EmptyState />
				) : filteredFeeds.length === 0 ? (
					<NoResults searchQuery={searchQuery} filterType={filterType} />
				) : (
					<div
						css={{
							display: 'grid',
							gridTemplateColumns: `repeat(auto-fill, minmax(${responsive.cardMinWidth}, 1fr))`,
							gap: spacing.lg,
							[mq.mobile]: {
								gap: spacing.md,
							},
						}}
					>
						{filteredFeeds.map((feed) => (
							<FeedCard key={feed.id} feed={feed} />
						))}
					</div>
				)}
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
				Failed to load feeds: {message}
			</p>
		</div>
	)
}

function EmptyState() {
	return () => (
		<div
			css={{
				textAlign: 'center',
				padding: spacing['2xl'],
				backgroundColor: colors.surface,
				borderRadius: radius.lg,
				border: `1px dashed ${colors.border}`,
			}}
		>
			<p
				css={{
					color: colors.textMuted,
					fontSize: typography.fontSize.lg,
					margin: 0,
					marginBottom: spacing.md,
				}}
			>
				No feeds yet
			</p>
			<p
				css={{
					color: colors.textMuted,
					fontSize: typography.fontSize.sm,
					margin: 0,
				}}
			>
				Create your first feed to get started
			</p>
		</div>
	)
}

function NoResults() {
	return ({
		searchQuery,
		filterType,
	}: {
		searchQuery: string
		filterType: FilterType
	}) => {
		const filterLabel = filterType !== 'all' ? ` ${filterType}` : ''
		const hasSearch = searchQuery.trim().length > 0

		return (
			<div
				css={{
					textAlign: 'center',
					padding: spacing['2xl'],
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
				}}
			>
				<p
					css={{
						color: colors.textMuted,
						fontSize: typography.fontSize.lg,
						margin: 0,
						marginBottom: spacing.md,
					}}
				>
					{hasSearch
						? `No${filterLabel} feeds match "${searchQuery}"`
						: `No${filterLabel} feeds found`}
				</p>
				<p
					css={{
						color: colors.textMuted,
						fontSize: typography.fontSize.sm,
						margin: 0,
					}}
				>
					{hasSearch
						? 'Try a different search term'
						: filterType !== 'all'
							? 'Try selecting a different filter'
							: 'Create your first feed to get started'}
				</p>
			</div>
		)
	}
}

/**
 * Parse directory paths from JSON string
 */
function parseDirectoryPaths(pathsJson: string): Array<string> {
	try {
		return JSON.parse(pathsJson) as Array<string>
	} catch {
		return []
	}
}

function FilterButton() {
	return ({
		active,
		onClick,
		color,
		children,
	}: {
		active: boolean
		onClick: () => void
		color?: string
		children: string
	}) => {
		const activeColor = color ?? colors.primary
		return (
			<button
				type="button"
				aria-pressed={active}
				css={{
					padding: `${spacing.xs} ${spacing.sm}`,
					fontSize: typography.fontSize.xs,
					fontWeight: typography.fontWeight.medium,
					color: active ? colors.background : colors.textMuted,
					backgroundColor: active ? activeColor : 'transparent',
					border: `1px solid ${active ? activeColor : colors.border}`,
					borderRadius: radius.sm,
					cursor: 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover': {
						borderColor: activeColor,
						color: active ? colors.background : colors.text,
					},
				}}
				on={{ click: onClick }}
			>
				{children}
			</button>
		)
	}
}

function FeedCard() {
	return ({ feed }: { feed: Feed }) => {
		const isDirectory = feed.type === 'directory'
		const directoryPaths = isDirectory
			? parseDirectoryPaths((feed as DirectoryFeed).directoryPaths)
			: []

		return (
			<div
				css={{
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.lg,
					display: 'flex',
					flexDirection: 'column',
					gap: spacing.md,
					transition: `all ${transitions.fast}`,
					boxShadow: shadows.sm,
					'&:hover': {
						boxShadow: shadows.md,
						borderColor: colors.primary,
					},
				}}
			>
				{/* Artwork and Header Row */}
				<div
					css={{
						display: 'flex',
						gap: spacing.md,
						alignItems: 'flex-start',
					}}
				>
					{/* Artwork */}
					<img
						src={`/admin/api/feeds/${feed.id}/artwork`}
						alt=""
						css={{
							width: '64px',
							height: '64px',
							borderRadius: radius.md,
							...artworkLayout.centeredContain,
							backgroundColor: colors.background,
							border: `1px solid ${colors.border}`,
							flexShrink: 0,
						}}
						on={{
							error: (e: Event) => {
								// Fallback to placeholder if no artwork
								const img = e.target as HTMLImageElement
								// Guard against repeated error events
								if (img.dataset.fallback) return
								img.dataset.fallback = 'true'
								// Escape XML special characters for the SVG
								const char = feed.name.trim()[0]?.toUpperCase() ?? '?'
								const escapedChar = char
									.replace(/&/g, '&amp;')
									.replace(/</g, '&lt;')
									.replace(/>/g, '&gt;')
								img.src = `data:image/svg+xml,${encodeURIComponent(
									`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1a1a2e"/><text x="32" y="40" font-family="system-ui" font-size="24" font-weight="bold" fill="#e94560" text-anchor="middle">${escapedChar}</text></svg>`,
								)}`
							},
						}}
					/>

					{/* Name and Badge */}
					<div css={{ flex: 1, minWidth: 0 }}>
						<div
							css={{
								display: 'flex',
								alignItems: 'flex-start',
								justifyContent: 'space-between',
								gap: spacing.sm,
								marginBottom: spacing.xs,
							}}
						>
							<Link
								href={`/admin/feeds/${feed.id}`}
								css={{
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									textDecoration: 'none',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									'&:hover': {
										color: colors.primary,
									},
								}}
							>
								{feed.name}
							</Link>
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
						{feed.description && (
							<p
								css={{
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									margin: 0,
									display: '-webkit-box',
									WebkitLineClamp: 2,
									WebkitBoxOrient: 'vertical',
									overflow: 'hidden',
								}}
							>
								{feed.description}
							</p>
						)}
					</div>
				</div>

				{isDirectory && directoryPaths.length > 0 && (
					<div
						css={{
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							fontFamily: 'monospace',
							display: 'flex',
							flexDirection: 'column',
							gap: spacing.xs,
						}}
					>
						{directoryPaths.map((path) => (
							<span
								key={path}
								css={{
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
								}}
							>
								{path}
							</span>
						))}
					</div>
				)}

				<div
					css={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						marginTop: 'auto',
						paddingTop: spacing.sm,
						borderTop: `1px solid ${colors.border}`,
						gap: spacing.md,
						flexWrap: 'wrap',
					}}
				>
					<span
						css={{
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
						}}
					>
						{feed.itemCount === 0 ? (
							<span css={{ color: '#f59e0b' }}>No files</span>
						) : (
							<>
								{feed.itemCount} file{feed.itemCount !== 1 ? 's' : ''}
							</>
						)}
					</span>
					<span
						css={{
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
						}}
					>
						{feed.lastAccessedAt ? (
							<>Accessed {formatRelativeTime(feed.lastAccessedAt)}</>
						) : (
							<span css={{ fontStyle: 'italic' }}>Never accessed</span>
						)}
					</span>
				</div>
			</div>
		)
	}
}
