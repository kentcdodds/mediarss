import {
	clientEntry,
	type Handle,
	css as rmxCss,
	type RemixNode,
	type SerializableValue,
} from 'remix/component'
import { routes } from '#app/routes.ts'
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
import { NavigationProgress } from './navigation-progress.tsx'
import { VersionPage } from './version.tsx'
import { matchAdminPage, type AdminPage } from './admin-pages.ts'
import {
	noAdminRouteLoaderData,
	type AdminRouteLoaderData,
	type AdminRoutePageProps,
} from './loader-data.ts'

type AdminAppProps = {
	[key: string]: SerializableValue
	url: string
	loaderData?: AdminRouteLoaderData
}

type VersionResponse = {
	version: string | null
	commit: { shortHash: string } | null
}

type AdminPageComponent = (
	handle: Handle<AdminRoutePageProps>,
) => () => RemixNode

const adminPages = [
	{ route: routes.admin, component: FeedList },
	{ route: routes.adminFeedNew, component: CreateFeed },
	{ route: routes.adminFeedEdit, component: FeedDetail },
	{ route: routes.adminFeed, component: FeedDetail },
	{ route: routes.adminMedia, component: MediaList },
	{ route: routes.adminMediaEdit, component: MediaDetail },
	{ route: routes.adminMediaDetail, component: MediaDetail },
	{ route: routes.adminVersion, component: VersionPage },
] satisfies ReadonlyArray<AdminPage<AdminPageComponent>>

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
	const renderAdminPage = () => {
		const match = matchAdminPage(adminPages, handle.props.url)
		if (!match) return <div>404 - Not Found</div>

		const Component = match.component
		return (
			<Component
				params={match.params}
				loaderData={handle.props.loaderData ?? noAdminRouteLoaderData}
				url={handle.props.url}
			/>
		)
	}

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
			<NavigationProgress />
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
						src="/logo.svg"
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
				{renderAdminPage()}
			</main>
			<AppFooter />
		</div>
	)
}

export const AdminApp = clientEntry(
	import.meta.url,
	function AdminApp(handle: Handle<AdminAppProps>): () => RemixNode {
		return () => (
			<AdminShell
				url={handle.props.url}
				loaderData={handle.props.loaderData ?? noAdminRouteLoaderData}
			/>
		)
	},
)
