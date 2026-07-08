import {
	clientEntry,
	type Handle,
	css as rmxCss,
	type RemixNode,
} from 'remix/ui'
import routes from '#app/config/routes.ts'
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

export const ADMIN_APP_ENTRY_ID = '/app/client/admin/entry.tsx#AdminApp'

type AdminAppProps = {
	url: string
}

type VersionResponse = {
	version: string | null
	commit: { shortHash: string } | null
}

router.register('/admin', FeedList)
router.register('/admin/feeds/new', CreateFeed)
router.register('/admin/feeds/:id/edit', FeedDetail)
router.register('/admin/feeds/:id', FeedDetail)
router.register('/admin/media', MediaList)
router.register('/admin/media/*/edit', MediaDetail)
router.register('/admin/media/*', MediaDetail)
router.register('/admin/version', VersionPage)

function AppFooter(handle: Handle) {
	let displayVersion: string | null = null

	handle.queueTask(async (signal) => {
		try {
			const res = await fetch('/admin/api/version', { signal })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = (await res.json()) as VersionResponse
			if (signal.aborted) return
			displayVersion = data.version || data.commit?.shortHash || null
			await handle.update()
		} catch {
			// Version display is non-critical.
		}
	})

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
				href={routes.adminVersion.href()}
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

function AdminShell(handle: Handle<AdminAppProps>) {
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
					href={routes.admin.href()}
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
				<RouterOutlet url={handle.props.url} />
			</main>
			<AppFooter />
		</div>
	)
}

export const AdminApp = clientEntry(
	ADMIN_APP_ENTRY_ID,
	function AdminApp(handle: Handle<AdminAppProps>): () => RemixNode {
		return () => <AdminShell url={handle.props.url} />
	},
)
