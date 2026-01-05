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
	tokenCount: number
	type: 'directory'
	createdAt: number
}

type CuratedFeed = {
	id: string
	name: string
	description: string
	tokenCount: number
	type: 'curated'
	createdAt: number
}

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
export function FeedList(this: Handle) {
	let state: LoadingState = { status: 'loading' }

	// Fetch feeds on mount
	fetch('/admin/api/feeds', { signal: this.signal })
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
			this.update()
		})
		.catch((err) => {
			if (this.signal.aborted) return
			state = { status: 'error', message: err.message }
			this.update()
		})

	return () => {
		if (state.status === 'loading') {
			return <LoadingSpinner />
		}

		if (state.status === 'error') {
			return <ErrorMessage message={state.message} />
		}

		const { feeds } = state

		return (
			<div>
				<div
					css={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						marginBottom: spacing.xl,
					}}
				>
					<h2
						css={{
							fontSize: typography.fontSize.xl,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
						}}
					>
						Your Feeds
					</h2>
					<Link
						href="/admin/feeds/new"
						css={{
							display: 'inline-flex',
							alignItems: 'center',
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

				{feeds.length === 0 ? (
					<EmptyState />
				) : (
					<div
						css={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
							gap: spacing.lg,
						}}
					>
						{feeds.map((feed) => (
							<FeedCard key={feed.id} feed={feed} />
						))}
					</div>
				)}
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
				Failed to load feeds: {message}
			</p>
		</div>
	)
}

function EmptyState() {
	return (
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

function FeedCard({ feed }: { feed: Feed }) {
	const isDirectory = feed.type === 'directory'

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
			<div
				css={{
					display: 'flex',
					alignItems: 'flex-start',
					justifyContent: 'space-between',
					gap: spacing.sm,
				}}
			>
				<div css={{ flex: 1, minWidth: 0 }}>
					<Link
						href={`/admin/feeds/${feed.id}`}
						css={{
							fontSize: typography.fontSize.lg,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							textDecoration: 'none',
							display: 'block',
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
				</div>
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
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
						margin: 0,
						display: '-webkit-box',
						WebkitLineClamp: '2',
						WebkitBoxOrient: 'vertical',
						overflow: 'hidden',
					}}
				>
					{feed.description}
				</p>
			)}

			{isDirectory && (
				<p
					css={{
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						margin: 0,
						fontFamily: 'monospace',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{(feed as DirectoryFeed).directoryPath}
				</p>
			)}

			<div
				css={{
					display: 'flex',
					alignItems: 'center',
					marginTop: 'auto',
					paddingTop: spacing.sm,
					borderTop: `1px solid ${colors.border}`,
				}}
			>
				<span
					css={{
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
					}}
				>
					{feed.tokenCount === 0 ? (
						<span css={{ color: '#f59e0b' }}>No tokens</span>
					) : (
						<>
							{feed.tokenCount} token{feed.tokenCount !== 1 ? 's' : ''}
						</>
					)}
				</span>
			</div>
		</div>
	)
}
