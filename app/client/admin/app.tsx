import { clientEntry, type Handle, css as rmxCss } from 'remix/ui'
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
import { RouterOutlet, router } from './router.tsx'
import { VersionPage } from './version.tsx'

const isBrowser = typeof window !== 'undefined'

router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id/edit', FeedDetail)
router.register('/admin/feeds/:id', FeedDetail)
router.register('/admin/media', MediaList)
router.register('/admin/media/*/edit', MediaDetail)
router.register('/admin/media/*', MediaDetail)
router.register('/admin/version', VersionPage)

type VersionResponse = {
	version: string | null
	commit: { shortHash: string } | null
}

type AdminAppProps = {
	initialHref?: string
}

function AppFooter(handle: Handle) {
	let displayVersion: string | null = null

	if (isBrowser) {
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
				// Version display is non-critical.
			})
	}

	return () => (
		<footer
			mix={[
				rmxCss({
					borderTop: `1px solid ${colors.border}`,
					padding: `${spacing.md} ${responsive.spacingHeader}`,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
				}),
			]}
		>
			<a
				href="/admin/version"
				mix={[
					rmxCss({
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						textDecoration: 'none',
						'&:hover': {
							color: colors.primary,
						},
					}),
				]}
			>
				{displayVersion ? `v${displayVersion}` : '...'}
			</a>
		</footer>
	)
}

export const AdminApp = clientEntry(
	'/app/client/admin/app.tsx#AdminApp',
	function AdminApp(handle: Handle<AdminAppProps>) {
		router.setLocation(handle.props.initialHref ?? '/admin')

		return () => (
			<div
				mix={[
					rmxCss({
						fontFamily: typography.fontFamily,
						minHeight: '100vh',
						backgroundColor: colors.background,
						display: 'flex',
						flexDirection: 'column',
					}),
				]}
			>
				<header
					mix={[
						rmxCss({
							borderBottom: `1px solid ${colors.border}`,
							padding: `${spacing.md} ${responsive.spacingHeader}`,
							display: 'flex',
							alignItems: 'center',
							gap: spacing.md,
							[mq.mobile]: {
								gap: spacing.sm,
							},
						}),
					]}
				>
					<a
						href="/admin"
						mix={[
							rmxCss({
								display: 'flex',
								alignItems: 'center',
								gap: spacing.md,
								textDecoration: 'none',
							}),
						]}
					>
						<img
							src="/assets/logo.svg"
							alt="MediaRSS"
							mix={[
								rmxCss({
									width: '36px',
									height: '36px',
								}),
							]}
						/>
						<h1
							mix={[
								rmxCss({
									fontSize: typography.fontSize.lg,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
								}),
							]}
						>
							MediaRSS
						</h1>
						<span
							mix={[
								rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.textMuted,
									[mq.mobile]: {
										display: 'none',
									},
								}),
							]}
						>
							Admin
						</span>
					</a>
				</header>
				<main
					mix={[
						rmxCss({
							flex: 1,
							maxWidth: '1200px',
							width: '100%',
							margin: '0 auto',
							padding: responsive.spacingPage,
						}),
					]}
				>
					<RouterOutlet />
				</main>
				<AppFooter />
			</div>
		)
	},
)
