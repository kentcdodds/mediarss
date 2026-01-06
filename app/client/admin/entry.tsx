import { createRoot } from '@remix-run/component'
import { colors, spacing, typography } from '#app/styles/tokens.ts'
import { CreateFeed } from './create-feed.tsx'
import { FeedDetail } from './feed-detail.tsx'
import { FeedList } from './feed-list.tsx'
import { MediaList } from './media-list.tsx'
import { RouterOutlet, router } from './router.tsx'

// Register routes
router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id', FeedDetail)
router.register('/admin/media', MediaList)

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
