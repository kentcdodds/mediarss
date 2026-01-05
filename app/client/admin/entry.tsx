import { createRoot } from '@remix-run/component'
import { colors, spacing, typography } from '#app/styles/tokens.ts'
import { FeedList } from './feed-list.tsx'
import { RouterOutlet, router } from './router.tsx'

// Placeholder components for routes not yet implemented
function CreateFeed() {
	return () => <div>Create Feed - Coming in Chunk 2</div>
}

function FeedDetail(_setupProps: { params: Record<string, string> }) {
	return (renderProps: { params: Record<string, string> }) => (
		<div>Feed Detail {renderProps.params.id} - Coming in Chunk 3</div>
	)
}

// Register routes
router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id', FeedDetail)

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
