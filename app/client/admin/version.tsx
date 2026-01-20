import type { Handle } from '@remix-run/component'
import {
	formatDate,
	formatRelativeTime,
	formatUptime,
} from '#app/helpers/format.ts'
import { colors, mq, radius, spacing, typography } from '#app/styles/tokens.ts'
import { Link } from './router.tsx'

type CommitInfo = {
	hash: string
	shortHash: string
	message: string
	date: string
}

type VersionResponse = {
	version: string | null
	commit: CommitInfo | null
	startTime: string
	uptimeMs: number
	githubRepo: string | undefined
}

type LoadingState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'success'; data: VersionResponse }

/**
 * Version page component - displays detailed version information.
 */
export function VersionPage(handle: Handle) {
	let state: LoadingState = { status: 'loading' }

	// Fetch version info on mount
	fetch('/admin/api/version', { signal: handle.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<VersionResponse>
		})
		.then((data) => {
			state = { status: 'success', data }
			handle.update()
		})
		.catch((err) => {
			if (handle.signal.aborted) return
			state = { status: 'error', message: err.message }
			handle.update()
		})

	return () => {
		if (state.status === 'loading') {
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

		if (state.status === 'error') {
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
						Failed to load version info: {state.message}
					</p>
				</div>
			)
		}

		const { data } = state
		const displayVersion = data.version || data.commit?.shortHash || 'Unknown'

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
							'&:hover': {
								color: colors.primary,
							},
						}}
					>
						← Back
					</Link>
				</div>

				<h2
					css={{
						fontSize: typography.fontSize.xl,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: 0,
						marginBottom: spacing.xl,
						[mq.mobile]: {
							fontSize: typography.fontSize.lg,
						},
					}}
				>
					Version Information
				</h2>

				<div
					css={{
						display: 'flex',
						flexDirection: 'column',
						gap: spacing.lg,
					}}
				>
					{/* App Version */}
					<InfoCard title="App Version">
						<InfoRow label="Version" value={displayVersion} />
					</InfoCard>

					{/* Git Commit */}
					{data.commit && (
						<InfoCard title="Git Commit">
							<InfoRow
								label="Hash"
								value={
									data.githubRepo ? (
										<a
											href={`${data.githubRepo}/commit/${data.commit.hash}`}
											target="_blank"
											rel="noopener noreferrer"
											css={{
												color: colors.primary,
												textDecoration: 'none',
												fontFamily: 'monospace',
												'&:hover': {
													textDecoration: 'underline',
												},
											}}
										>
											{data.commit.shortHash}
										</a>
									) : (
										<span css={{ fontFamily: 'monospace' }}>
											{data.commit.shortHash}
										</span>
									)
								}
							/>
							<InfoRow
								label="Message"
								value={data.commit.message.split('\n')[0] ?? ''}
							/>
							<InfoRow
								label="Date"
								value={`${formatDate(data.commit.date)} (${formatRelativeTime(data.commit.date)})`}
							/>
						</InfoCard>
					)}

					{/* Server Info */}
					<InfoCard title="Server">
						<InfoRow label="Started" value={formatDate(data.startTime)} />
						<InfoRow label="Uptime" value={formatUptime(data.uptimeMs)} />
					</InfoCard>

					{/* Links */}
					{data.githubRepo && (
						<InfoCard title="Links">
							<InfoRow
								label="GitHub"
								value={
									<a
										href={data.githubRepo}
										target="_blank"
										rel="noopener noreferrer"
										css={{
											color: colors.primary,
											textDecoration: 'none',
											'&:hover': {
												textDecoration: 'underline',
											},
										}}
									>
										{data.githubRepo}
									</a>
								}
							/>
						</InfoCard>
					)}
				</div>
			</div>
		)
	}
}

function InfoCard() {
	return ({
		title,
		children,
	}: {
		title: string
		children: JSX.Element | Array<JSX.Element>
	}) => (
		<div
			css={{
				backgroundColor: colors.surface,
				borderRadius: radius.lg,
				border: `1px solid ${colors.border}`,
				overflow: 'hidden',
			}}
		>
			<div
				css={{
					padding: `${spacing.sm} ${spacing.lg}`,
					backgroundColor: colors.primarySoftest,
					borderBottom: `1px solid ${colors.border}`,
				}}
			>
				<h3
					css={{
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
						margin: 0,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
					}}
				>
					{title}
				</h3>
			</div>
			<div
				css={{
					padding: spacing.lg,
					display: 'flex',
					flexDirection: 'column',
					gap: spacing.md,
				}}
			>
				{children}
			</div>
		</div>
	)
}

function InfoRow() {
	return ({ label, value }: { label: string; value: string | JSX.Element }) => (
		<div
			css={{
				display: 'flex',
				alignItems: 'flex-start',
				gap: spacing.md,
				[mq.mobile]: {
					flexDirection: 'column',
					gap: spacing.xs,
				},
			}}
		>
			<span
				css={{
					fontSize: typography.fontSize.sm,
					color: colors.textMuted,
					minWidth: '100px',
					flexShrink: 0,
				}}
			>
				{label}
			</span>
			<span
				css={{
					fontSize: typography.fontSize.sm,
					color: colors.text,
					wordBreak: 'break-word',
				}}
			>
				{value}
			</span>
		</div>
	)
}
