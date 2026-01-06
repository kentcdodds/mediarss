import { createRoot } from '@remix-run/component'
import { colors, spacing, typography } from '#app/styles/tokens.ts'
import { CreateFeed } from './create-feed.tsx'
import { FeedDetail } from './feed-detail.tsx'
import { FeedList } from './feed-list.tsx'
import { MediaDetail } from './media-detail.tsx'
import { MediaList } from './media-list.tsx'
import { Link, RouterOutlet, router } from './router.tsx'

// Register routes
router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id', FeedDetail)
router.register('/admin/media', MediaList)
router.register('/admin/media/*', MediaDetail)

function AdminApp() {
	return () => (
		<div
			css={{
				fontFamily: typography.fontFamily,
				minHeight: '100vh',
				backgroundColor: colors.background,
			}}
		>
			<header
				css={{
					borderBottom: `1px solid ${colors.border}`,
					padding: `${spacing.md} ${spacing.xl}`,
					display: 'flex',
					alignItems: 'center',
					gap: spacing.lg,
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
						}}
					>
						Admin
					</span>
				</Link>
			</header>
			<main
				css={{
					maxWidth: '1200px',
					margin: '0 auto',
					padding: spacing['2xl'],
				}}
			>
				<RouterOutlet />
			</main>
		</div>
	)
}

const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<AdminApp />)
