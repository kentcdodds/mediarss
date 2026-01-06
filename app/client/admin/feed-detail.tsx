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
		const activeTokens = tokens.filter((t) => !t.revokedAt)
		const revokedTokens = tokens.filter((t) => t.revokedAt)

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
					<h3
						css={{
							fontSize: typography.fontSize.base,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: `0 0 ${spacing.md} 0`,
						}}
					>
						Feed Details
					</h3>

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
					<h3
						css={{
							fontSize: typography.fontSize.base,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: `0 0 ${spacing.lg} 0`,
						}}
					>
						Media Items ({items.length})
					</h3>

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
									</tr>
								</thead>
								<tbody>
									{items.map((item, index) => (
										<tr
											key={item.path}
											css={{
												borderBottom: `1px solid ${colors.border}`,
												'&:last-child': { borderBottom: 'none' },
												'&:hover': {
													backgroundColor: colors.background,
												},
											}}
										>
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
