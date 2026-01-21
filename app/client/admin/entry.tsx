import { createRoot, type Handle } from 'remix/component'
import {
	colors,
	mq,
	responsive,
	spacing,
	typography,
} from '#app/styles/tokens.ts'
import { CreateFeed } from './create-feed.tsx'
import { FeedDetail } from './feed-detail.tsx'
import { FeedList } from './feed-list.tsx'
import { MediaDetail } from './media-detail.tsx'
import { MediaList } from './media-list.tsx'
import { Link, RouterOutlet, router } from './router.tsx'
import { VersionPage } from './version.tsx'

// Register routes
router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id', FeedDetail)
router.register('/admin/media', MediaList)
router.register('/admin/media/*', MediaDetail)
router.register('/admin/version', VersionPage)

type VersionResponse = {
	version: string | null
	commit: { shortHash: string } | null
}

/**
 * Footer component that displays the app version.
 */
function AppFooter(handle: Handle) {
	let displayVersion: string | null = null

	// Fetch version info on mount
	fetch('/admin/api/version', { signal: handle.signal })
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json() as Promise<VersionResponse>
		})
		.then((data) => {
			displayVersion = data.version || data.commit?.shortHash || null
			handle.update()
		})
		.catch(() => {
			// Silently fail - version display is not critical
		})

	return () => (
		<footer
			css={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${spacing.md} ${responsive.spacingHeader}`,
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<Link
				href="/admin/version"
				css={{
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textDecoration: 'none',
					'&:hover': {
						color: colors.primary,
					},
				}}
			>
				{displayVersion ? `v${displayVersion}` : '...'}
			</Link>
		</footer>
	)
}

function AdminApp() {
	return () => (
		<div
			css={{
				fontFamily: typography.fontFamily,
				minHeight: '100vh',
				backgroundColor: colors.background,
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			<header
				css={{
					borderBottom: `1px solid ${colors.border}`,
					padding: `${spacing.md} ${responsive.spacingHeader}`,
					display: 'flex',
					alignItems: 'center',
					gap: spacing.md,
					[mq.mobile]: {
						gap: spacing.sm,
					},
				}}
			>
				<Link
					href="/admin"
					css={{
						display: 'flex',
						alignItems: 'center',
						gap: spacing.md,
						textDecoration: 'none',
					}}
				>
					<img
						src="/assets/logo.svg"
						alt="MediaRSS"
						css={{
							width: '36px',
							height: '36px',
						}}
					/>
					<h1
						css={{
							fontSize: typography.fontSize.lg,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
						}}
					>
						MediaRSS
					</h1>
					<span
						css={{
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
							[mq.mobile]: {
								display: 'none',
							},
						}}
					>
						Admin
					</span>
				</Link>
			</header>
			<main
				css={{
					flex: 1,
					maxWidth: '1200px',
					width: '100%',
					margin: '0 auto',
					padding: responsive.spacingPage,
				}}
			>
				<RouterOutlet />
			</main>
			<AppFooter />
		</div>
	)
}

const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<AdminApp />)
