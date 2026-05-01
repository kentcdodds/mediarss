import { css as rmxCss, type RemixNode } from 'remix/ui'
import {
	getGitHubRepo,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import {
	listActiveCuratedFeedTokens,
	listCuratedFeedTokens,
} from '#app/db/curated-feed-tokens.ts'
import { listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	listActiveDirectoryFeedTokens,
	listDirectoryFeedTokens,
} from '#app/db/directory-feed-tokens.ts'
import {
	listDirectoryFeeds,
	parseDirectoryPaths,
} from '#app/db/directory-feeds.ts'
import { getItemsForFeed } from '#app/db/feed-items.ts'
import {
	type DirectoryFeed,
	isDirectoryFeed,
	type Feed,
	type FeedType,
} from '#app/db/types.ts'
import {
	formatDate,
	formatDuration,
	formatFileSize,
	formatRelativeTime,
} from '#app/helpers/format.ts'
import {
	getFeedAnalyticsByToken,
	getFeedAnalyticsSummary,
	getFeedDailyAnalytics,
	getFeedTopClientAnalytics,
	getFeedTopMediaItemAnalytics,
} from '#app/db/feed-analytics-events.ts'
import { hasFeedArtwork } from '#app/helpers/feed-artwork.ts'
import { scanAllMediaRoots, scanDirectory } from '#app/helpers/media.ts'
import { createMediaKey } from '#app/helpers/path-parsing.ts'
import {
	getCuratedFeedItems,
	getDirectoryFeedItems,
} from '#app/helpers/feed-items.ts'
import { getVersionInfo } from '#app/helpers/version.ts'
import {
	artworkLayout,
	colors,
	mq,
	radius,
	responsive,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'
import { handleAdminPost } from './admin-actions.tsx'
import {
	buttonStyle,
	cardStyle,
	dangerButtonStyle,
	emptyStateStyle,
	gridStyle,
	inputStyle,
	labelStyle,
	mutedStyle,
	rowStyle,
	secondaryButtonStyle,
	stackStyle,
} from './admin-styles.ts'
import { getAdminFeed, renderAdminPage } from './admin-utils.tsx'

const EDIT_SUFFIX = '/edit'

type FeedSummary = {
	id: string
	name: string
	description: string
	type: 'directory' | 'curated'
	itemCount: number
	tokenCount: number
	lastAccessedAt: number | null
	updatedAt: number
	directoryPaths?: Array<string>
}

type FeedTokenSummary = {
	token: string
	label: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
}

type FeedTokenAnalytics = FeedTokenSummary & {
	rssFetches: number
	mediaRequests: number
	downloadStarts: number
	bytesServed: number
	uniqueClients: number
	firstSeenAt: number | null
	lastSeenAt: number | null
}

type FeedDetailData = {
	feed: Feed
	isDirectory: boolean
	tokens: Array<FeedTokenSummary>
	items: Awaited<ReturnType<typeof getDirectoryFeedItems>>
	hasUploadedArtwork: boolean
	analytics: {
		summary: ReturnType<typeof getFeedAnalyticsSummary>
		byToken: Array<FeedTokenAnalytics>
		topClients: ReturnType<typeof getFeedTopClientAnalytics>
		topMediaItems: ReturnType<typeof getFeedTopMediaItemAnalytics>
		daily: ReturnType<typeof getFeedDailyAnalytics>
	}
}

export async function handleAdminRequest(request: Request) {
	if (request.method === 'POST') {
		return handleAdminPost(request)
	}
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method Not Allowed', { status: 405 })
	}

	const url = new URL(request.url)
	const path = normalizePath(url.pathname)
	const target = request.headers.get('x-remix-target')
	const pageOptions = { request, target }

	if (path === '/admin') {
		return renderAdminPage({
			title: 'MediaRSS Admin',
			body: await renderFeedIndex(),
			...pageOptions,
		})
	}

	if (path === '/admin/version') {
		return renderAdminPage({
			title: 'Version Information',
			body: await renderVersionPage(),
			isVersionPage: true,
			...pageOptions,
		})
	}

	if (path === '/admin/feeds/new') {
		return renderAdminPage({
			title: 'New Feed',
			body: renderNewFeedPage(),
			...pageOptions,
		})
	}

	if (path === '/admin/feeds/new/directory') {
		return renderAdminPage({
			title: 'New Directory Feed',
			body: renderNewDirectoryFeedPage(),
			...pageOptions,
		})
	}

	if (path === '/admin/feeds/new/curated') {
		return renderAdminPage({
			title: 'New Curated Feed',
			body: await renderNewCuratedFeedPage(),
			...pageOptions,
		})
	}

	const feedMatch = /^\/admin\/feeds\/([^/]+)(\/edit)?$/.exec(path)
	if (feedMatch?.[1]) {
		return feedMatch[2]
			? renderFeedEditPage(feedMatch[1], pageOptions)
			: renderFeedDetailPage(feedMatch[1], pageOptions)
	}

	if (path === '/admin/media') {
		return renderAdminPage({
			title: 'Media',
			body: await renderMediaIndex(url),
			...pageOptions,
		})
	}

	const mediaMatch = /^\/admin\/media\/(.+)$/.exec(path)
	if (mediaMatch?.[1]) {
		let mediaPath: string
		try {
			mediaPath = decodeURIComponent(mediaMatch[1])
		} catch {
			return renderAdminPage({
				title: 'Invalid Media Path',
				body: (
					<section mix={cardStyle}>
						<h1>Invalid media path</h1>
						<p>The requested media path is not valid.</p>
						<a href="/admin/media" mix={buttonStyle}>
							Back to media
						</a>
					</section>
				),
				status: 400,
				...pageOptions,
			})
		}
		return renderMediaDetailPage(
			mediaPath,
			pageOptions,
			getEditFallback(mediaPath),
		)
	}

	return renderAdminPage({
		title: 'Not Found',
		body: (
			<section mix={cardStyle}>
				<h2>404 Not Found</h2>
				<p>The admin page you requested does not exist.</p>
				<a href="/admin" mix={buttonStyle}>
					Back to admin
				</a>
			</section>
		),
		status: 404,
		...pageOptions,
	})
}

async function renderFeedIndex() {
	const feeds = await getFeedSummaries()

	return (
		<div mix={stackStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'flex-start',
					marginBottom: spacing.lg,
					gap: spacing.md,
					flexWrap: 'wrap',
					[mq.mobile]: {
						flexDirection: 'column',
						alignItems: 'stretch',
					},
				})}
			>
				<div>
					<h2
						mix={rmxCss({
							fontSize: typography.fontSize.xl,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
							[mq.mobile]: {
								fontSize: typography.fontSize.lg,
							},
						})}
					>
						Your Feeds
					</h2>
					{feeds.length > 0 ? (
						<p
							mix={rmxCss({
								fontSize: typography.fontSize.sm,
								color: colors.textMuted,
								margin: `${spacing.xs} 0 0 0`,
							})}
						>
							{feeds.length} feed{feeds.length === 1 ? '' : 's'}
						</p>
					) : null}
				</div>
				<div
					mix={rmxCss({
						display: 'flex',
						gap: spacing.sm,
						[mq.mobile]: {
							flexDirection: 'column',
						},
					})}
				>
					<a href="/admin/media" mix={secondaryButtonStyle}>
						Manage Access
					</a>
					<a href="/admin/feeds/new" mix={buttonStyle}>
						+ New Feed
					</a>
				</div>
			</div>
			{feeds.length === 0 ? (
				<section mix={emptyStateStyle}>
					<p
						mix={rmxCss({
							color: colors.textMuted,
							fontSize: typography.fontSize.lg,
							margin: 0,
							marginBottom: spacing.md,
						})}
					>
						No feeds yet
					</p>
					<p
						mix={rmxCss({
							color: colors.textMuted,
							fontSize: typography.fontSize.sm,
							margin: 0,
						})}
					>
						Create your first feed to get started
					</p>
				</section>
			) : (
				<section mix={gridStyle}>
					{feeds.map((feed) => (
						<FeedSummaryCard key={feed.id} feed={feed} />
					))}
				</section>
			)}
		</div>
	)
}

function FeedSummaryCard() {
	return ({ feed }: { feed: FeedSummary }) => {
		const isDirectory = feed.type === 'directory'
		return (
			<article
				mix={rmxCss({
					backgroundColor: colors.surface,
					borderRadius: radius.lg,
					border: `1px solid ${colors.border}`,
					padding: spacing.lg,
					display: 'flex',
					flexDirection: 'column',
					gap: spacing.md,
					transition: `all var(--transition-fast)`,
					boxShadow: shadows.sm,
					'&:hover': {
						boxShadow: shadows.md,
						borderColor: colors.primary,
					},
				})}
			>
				<div
					mix={rmxCss({
						display: 'flex',
						gap: spacing.md,
						alignItems: 'flex-start',
					})}
				>
					<img
						src={`/admin/api/feeds/${feed.id}/artwork`}
						alt=""
						width="64"
						height="64"
						mix={rmxCss({
							width: '64px',
							height: '64px',
							borderRadius: radius.md,
							...artworkLayout.centeredContain,
							backgroundColor: colors.background,
							border: `1px solid ${colors.border}`,
							flexShrink: 0,
						})}
					/>
					<div mix={rmxCss({ flex: 1, minWidth: 0 })}>
						<div
							mix={rmxCss({
								display: 'flex',
								alignItems: 'flex-start',
								justifyContent: 'space-between',
								gap: spacing.sm,
								marginBottom: spacing.xs,
							})}
						>
							<a
								href={`/admin/feeds/${feed.id}`}
								mix={rmxCss({
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									textDecoration: 'none',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									'&:hover': {
										color: colors.primary,
									},
								})}
							>
								{feed.name}
							</a>
							<span
								mix={rmxCss({
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
								})}
							>
								{feed.type}
							</span>
						</div>
						{feed.description ? (
							<p
								mix={rmxCss({
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									margin: 0,
									display: '-webkit-box',
									WebkitLineClamp: 2,
									WebkitBoxOrient: 'vertical',
									overflow: 'hidden',
								})}
							>
								{feed.description}
							</p>
						) : null}
					</div>
				</div>

				{feed.directoryPaths && feed.directoryPaths.length > 0 ? (
					<div
						mix={rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
							fontFamily: 'monospace',
							display: 'flex',
							flexDirection: 'column',
							gap: spacing.xs,
						})}
					>
						{feed.directoryPaths.map((path) => (
							<span
								key={path}
								mix={rmxCss({
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
								})}
							>
								{path}
							</span>
						))}
					</div>
				) : null}

				<div
					mix={rmxCss({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						marginTop: 'auto',
						paddingTop: spacing.sm,
						borderTop: `1px solid ${colors.border}`,
						gap: spacing.md,
						flexWrap: 'wrap',
					})}
				>
					<span
						mix={rmxCss({
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
						})}
					>
						{feed.itemCount === 0 ? (
							<span mix={rmxCss({ color: '#f59e0b' })}>No files</span>
						) : (
							<>
								{feed.itemCount} file{feed.itemCount !== 1 ? 's' : ''}
							</>
						)}
						{' · '}
						{feed.tokenCount} token{feed.tokenCount !== 1 ? 's' : ''}
					</span>
					<span
						mix={rmxCss({
							fontSize: typography.fontSize.xs,
							color: colors.textMuted,
						})}
					>
						{feed.lastAccessedAt ? (
							<>Accessed {formatRelativeTime(feed.lastAccessedAt)}</>
						) : (
							<span mix={rmxCss({ fontStyle: 'italic' })}>Never accessed</span>
						)}
					</span>
				</div>
			</article>
		)
	}
}

const cardLinkStyle = {
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.md,
	padding: spacing.lg,
	color: colors.text,
	textDecoration: 'none',
	border: `1px solid ${colors.primary}`,
	borderRadius: 'var(--radius-lg)',
	backgroundColor: colors.surface,
}

function renderNewFeedPage() {
	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>New Feed</h1>
			</div>
			<p mix={mutedStyle}>Choose the kind of feed you want to create.</p>
			<section mix={gridStyle}>
				<a href="/admin/feeds/new/directory" mix={rmxCss(cardLinkStyle)}>
					<h2 mix={rmxCss({ marginTop: 0 })}>Directory feed</h2>
					<p mix={rmxCss({ flex: 1 })}>
						Publish a feed from one or more media folders. New matching files
						are picked up from those directories.
					</p>
					<span mix={buttonStyle}>Create directory feed</span>
				</a>
				<a href="/admin/feeds/new/curated" mix={rmxCss(cardLinkStyle)}>
					<h2 mix={rmxCss({ marginTop: 0 })}>Curated feed</h2>
					<p mix={rmxCss({ flex: 1 })}>
						Hand-pick specific media files for a feed and manage the item list
						manually.
					</p>
					<span mix={buttonStyle}>Create curated feed</span>
				</a>
			</section>
		</div>
	)
}

function renderNewDirectoryFeedPage() {
	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin/feeds/new" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>New Directory Feed</h1>
			</div>
			<section mix={gridStyle}>
				<form method="post" action="/admin/feeds/new" mix={cardStyle}>
					<input type="hidden" name="_action" value="create-directory-feed" />
					<h2>Directory feed</h2>
					{renderFeedFields('filename', 'asc', 'episodic')}
					<label mix={labelStyle}>
						Directory paths
						<textarea
							name="directoryPaths"
							required
							rows={5}
							placeholder="audio:series/example"
							mix={inputStyle}
						/>
					</label>
					<p mix={mutedStyle}>
						Enter one mediaRoot:relativePath value per line.
					</p>
					<button type="submit" mix={buttonStyle}>
						Create directory feed
					</button>
				</form>
			</section>
		</div>
	)
}

async function renderNewCuratedFeedPage() {
	const media = await scanAllMediaRoots()
	const mediaOptions = media.slice(0, 200)

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin/feeds/new" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>New Curated Feed</h1>
			</div>
			<section mix={gridStyle}>
				<form method="post" action="/admin/feeds/new" mix={cardStyle}>
					<input type="hidden" name="_action" value="create-curated-feed" />
					<h2>Curated feed</h2>
					{renderFeedFields('position', 'asc', 'episodic')}
					<label mix={labelStyle}>
						Initial items
						<select name="items" multiple size={10} mix={inputStyle}>
							{mediaOptions.map((file) => (
								<option key={file.path} value={file.path}>
									{file.title} ({file.path})
								</option>
							))}
						</select>
					</label>
					<button type="submit" mix={buttonStyle}>
						Create curated feed
					</button>
				</form>
			</section>
		</div>
	)
}

async function renderFeedDetailPage(
	feedId: string,
	pageOptions: { request: Request; target: string | null },
) {
	const detail = await getFeedDetailData(feedId)
	if (!detail) {
		return renderFeedNotFound(pageOptions)
	}

	return renderAdminPage({
		title: detail.feed.name,
		body: renderFeedDetail(detail),
		...pageOptions,
	})
}

async function renderFeedEditPage(
	feedId: string,
	pageOptions: { request: Request; target: string | null },
) {
	const feed = await getAdminFeed(feedId)
	if (!feed) {
		return renderFeedNotFound(pageOptions)
	}

	const isDirectory = isDirectoryFeed(feed)
	const items = isDirectory ? [] : await getItemsForFeed(feed.id)
	const media = isDirectory ? [] : await scanAllMediaRoots()

	return renderAdminPage({
		title: feed.name,
		body: (
			<div mix={stackStyle}>
				<div mix={rowStyle}>
					<a href="/admin" mix={secondaryButtonStyle}>
						Back
					</a>
					<h1 mix={rmxCss({ margin: 0 })}>{feed.name}</h1>
				</div>
				<section mix={gridStyle}>
					<form
						method="post"
						action={`/admin/feeds/${feed.id}`}
						mix={cardStyle}
					>
						<input type="hidden" name="_action" value="update-feed" />
						<input type="hidden" name="feedId" value={feed.id} />
						<h2>Edit feed</h2>
						{renderFeedFields(
							feed.sortFields,
							feed.sortOrder,
							feed.feedType ?? 'episodic',
							feed,
						)}
						{isDirectoryFeed(feed) ? (
							<label mix={labelStyle}>
								Directory paths
								<textarea
									name="directoryPaths"
									rows={5}
									mix={inputStyle}
									required
								>
									{parseDirectoryPaths(feed).join('\n')}
								</textarea>
							</label>
						) : null}
						<button type="submit" mix={buttonStyle}>
							Save feed
						</button>
					</form>
					<section mix={cardStyle}>
						<h2>Access</h2>
						<form
							method="post"
							action={`/admin/feeds/${feed.id}`}
							mix={rowStyle}
						>
							<input type="hidden" name="_action" value="create-token" />
							<input type="hidden" name="feedId" value={feed.id} />
							<label mix={labelStyle}>
								Token label
								<input
									name="label"
									placeholder="Optional label"
									mix={inputStyle}
								/>
							</label>
							<button type="submit" mix={buttonStyle}>
								Create token
							</button>
						</form>
						<p mix={mutedStyle}>
							Use the generated feed URL from the feed API token list.
						</p>
					</section>
				</section>
				{isDirectory
					? renderDirectoryFeedDetails(feed)
					: renderCuratedItems(feed, items, media)}
				<form method="post" action={`/admin/feeds/${feed.id}`} mix={cardStyle}>
					<input type="hidden" name="_action" value="delete-feed" />
					<input type="hidden" name="feedId" value={feed.id} />
					<h2>Danger zone</h2>
					<button type="submit" mix={dangerButtonStyle}>
						Delete feed
					</button>
				</form>
			</div>
		),
		...pageOptions,
	})
}

function renderFeedNotFound(pageOptions: {
	request: Request
	target: string | null
}) {
	return renderAdminPage({
		title: 'Feed Not Found',
		body: (
			<section mix={cardStyle}>
				<h1>Feed not found</h1>
				<a href="/admin" mix={buttonStyle}>
					Back to feeds
				</a>
			</section>
		),
		status: 404,
		...pageOptions,
	})
}

async function getFeedDetailData(
	feedId: string,
): Promise<FeedDetailData | null> {
	const feed = await getAdminFeed(feedId)
	if (!feed) return null

	const isDirectory = isDirectoryFeed(feed)
	const tokens = isDirectory
		? await listDirectoryFeedTokens(feed.id)
		: await listCuratedFeedTokens(feed.id)
	const items = isDirectory
		? await getDirectoryFeedItems(feed)
		: await getCuratedFeedItems(feed)
	const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
	const tokenMetrics = getFeedAnalyticsByToken(feed.id, since)

	return {
		feed,
		isDirectory,
		tokens,
		items,
		hasUploadedArtwork: await hasFeedArtwork(feed.id),
		analytics: {
			summary: getFeedAnalyticsSummary(feed.id, since),
			byToken: buildTokenAnalytics(tokens, tokenMetrics),
			topClients: getFeedTopClientAnalytics(feed.id, since),
			topMediaItems: getFeedTopMediaItemAnalytics(feed.id, since),
			daily: getFeedDailyAnalytics(feed.id, since),
		},
	}
}

function buildTokenAnalytics(
	tokens: Array<FeedTokenSummary>,
	tokenMetrics: ReturnType<typeof getFeedAnalyticsByToken>,
): Array<FeedTokenAnalytics> {
	const tokenMetadataByToken = new Map(
		tokens.map((token) => [token.token, token]),
	)
	const tokenMetricsByToken = new Map(
		tokenMetrics.map((metrics) => [metrics.token, metrics]),
	)

	const byToken = tokens.map((token): FeedTokenAnalytics => {
		const metrics = tokenMetricsByToken.get(token.token)
		return {
			...token,
			rssFetches: metrics?.rssFetches ?? 0,
			mediaRequests: metrics?.mediaRequests ?? 0,
			downloadStarts: metrics?.downloadStarts ?? 0,
			bytesServed: metrics?.bytesServed ?? 0,
			uniqueClients: metrics?.uniqueClients ?? 0,
			firstSeenAt: metrics?.firstSeenAt ?? null,
			lastSeenAt: metrics?.lastSeenAt ?? null,
		}
	})

	for (const metrics of tokenMetrics) {
		if (tokenMetadataByToken.has(metrics.token)) continue
		byToken.push({
			token: metrics.token,
			label: 'Deleted token',
			createdAt: 0,
			lastUsedAt: null,
			revokedAt: null,
			rssFetches: metrics.rssFetches,
			mediaRequests: metrics.mediaRequests,
			downloadStarts: metrics.downloadStarts,
			bytesServed: metrics.bytesServed,
			uniqueClients: metrics.uniqueClients,
			firstSeenAt: metrics.firstSeenAt,
			lastSeenAt: metrics.lastSeenAt,
		})
	}

	return byToken.sort((a, b) => {
		if (b.downloadStarts !== a.downloadStarts) {
			return b.downloadStarts - a.downloadStarts
		}
		if (b.mediaRequests !== a.mediaRequests) {
			return b.mediaRequests - a.mediaRequests
		}
		return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
	})
}

function renderFeedDetail(detail: FeedDetailData) {
	const { feed, isDirectory, items, tokens, hasUploadedArtwork, analytics } =
		detail
	const directoryPaths = isDirectoryFeed(feed) ? parseDirectoryPaths(feed) : []
	const activeTokens = tokens.filter((token) => !token.revokedAt)
	return (
		<div mix={detailPageStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					alignItems: 'center',
					gap: spacing.md,
					flexWrap: 'wrap',
					[mq.mobile]: {
						flexDirection: 'column',
						alignItems: 'stretch',
						gap: spacing.sm,
					},
				})}
			>
				<div
					mix={rmxCss({
						display: 'flex',
						alignItems: 'center',
						gap: spacing.md,
						flex: 1,
						minWidth: 0,
						[mq.mobile]: {
							flexWrap: 'wrap',
						},
					})}
				>
					<a
						href="/admin"
						mix={rmxCss({
							color: colors.textMuted,
							textDecoration: 'none',
							fontSize: typography.fontSize.sm,
							'&:hover': { color: colors.text },
							flexShrink: 0,
						})}
					>
						← Back
					</a>
					<h1
						mix={rmxCss({
							fontSize: typography.fontSize.xl,
							fontWeight: typography.fontWeight.semibold,
							color: colors.text,
							margin: 0,
							flex: 1,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							[mq.mobile]: {
								fontSize: typography.fontSize.lg,
								flex: 'none',
								width: '100%',
								order: 2,
							},
						})}
					>
						{feed.name}
					</h1>
					<span
						mix={rmxCss({
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
						})}
					>
						{isDirectory ? 'directory' : 'curated'}
					</span>
				</div>
				<div
					mix={rmxCss({
						display: 'flex',
						gap: spacing.sm,
						[mq.mobile]: {
							width: '100%',
						},
					})}
				>
					<a
						href={`/admin/feeds/${feed.id}/edit`}
						mix={compactOutlineButtonStyle}
					>
						Edit Feed
					</a>
					<form
						method="post"
						action={`/admin/feeds/${feed.id}`}
						mix={rmxCss({ display: 'contents' })}
					>
						<input type="hidden" name="_action" value="delete-feed" />
						<input type="hidden" name="feedId" value={feed.id} />
						<button type="submit" mix={compactDangerOutlineButtonStyle}>
							Delete
						</button>
					</form>
				</div>
			</div>

			<div mix={detailSectionsStyle}>
				<section mix={detailCardStyle}>
					<h2 mix={sectionTitleStyle}>Feed Details</h2>
					<p mix={rmxCss({ color: colors.textMuted, marginTop: 0 })}>
						{feed.description || 'No description.'}
					</p>
					<dl mix={detailGridStyle}>
						{isDirectory ? renderDirectoriesInfo(directoryPaths) : null}
						{renderInfoItem(
							'Feed Type',
							feed.feedType === 'serial' ? 'Serial' : 'Episodic',
						)}
						{renderInfoItem('Subtitle', feed.subtitle ?? '—')}
						{renderInfoItem('Author', feed.author ?? '—')}
						{renderInfoItem('Owner Name', feed.ownerName ?? '—')}
						{renderInfoItem('Owner Email', feed.ownerEmail ?? '—')}
						{renderInfoItem('Website', feed.link ?? '—', {
							mono: Boolean(feed.link),
							href: feed.link ?? undefined,
						})}
						{renderInfoItem('Copyright', feed.copyright ?? '—')}
						{renderInfoItem(
							'Sort',
							feed.sortFields === 'position'
								? 'position (manual)'
								: `${feed.sortFields} (${feed.sortOrder})`,
						)}
						{renderInfoItem(
							'Created',
							formatDate(feed.createdAt, { style: 'short' }),
						)}
						{renderInfoItem(
							'Updated',
							formatDate(feed.updatedAt, { style: 'short' }),
						)}
					</dl>
				</section>

				<section mix={detailCardStyle}>
					<h2 mix={sectionTitleStyle}>Feed Artwork</h2>
					<div mix={rowStyle}>
						<img
							src={`/admin/api/feeds/${feed.id}/artwork?t=${feed.updatedAt}`}
							alt="Feed artwork"
							width="120"
							height="120"
							mix={rmxCss({
								width: '120px',
								height: '120px',
								borderRadius: radius.md,
								...artworkLayout.centeredContain,
								backgroundColor: colors.background,
								border: `1px solid ${colors.border}`,
							})}
						/>
						<div>
							<form
								method="post"
								action={`/admin/feeds/${feed.id}`}
								enctype="multipart/form-data"
								mix={artworkFormStyle}
							>
								<input type="hidden" name="_action" value="upload-artwork" />
								<input type="hidden" name="feedId" value={feed.id} />
								<input
									type="file"
									name="file"
									accept="image/jpeg,image/png,image/webp"
									required
									mix={artworkFileInputStyle}
								/>
								<button type="submit" mix={compactPrimaryButtonStyle}>
									Upload Artwork
								</button>
							</form>
							<p
								mix={rmxCss({
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									margin: `${spacing.xs} 0 ${hasUploadedArtwork ? spacing.md : 0} 0`,
								})}
							>
								JPEG, PNG, or WebP. Max 5MB.
							</p>
							{hasUploadedArtwork ? (
								<form method="post" action={`/admin/feeds/${feed.id}`}>
									<input type="hidden" name="_action" value="delete-artwork" />
									<input type="hidden" name="feedId" value={feed.id} />
									<button type="submit" mix={compactDangerOutlineButtonStyle}>
										Remove Uploaded
									</button>
								</form>
							) : null}
						</div>
					</div>
				</section>

				{renderMediaItemsSection(items)}
				{renderAnalyticsSection(analytics)}
				{renderTokensSection(feed, activeTokens)}
			</div>
		</div>
	)
}

const sectionTitleRules = {
	fontSize: typography.fontSize.base,
	fontWeight: typography.fontWeight.semibold,
	color: colors.text,
	margin: `0 0 ${spacing.md} 0`,
}

const sectionTitleStyle = rmxCss(sectionTitleRules)

const detailCardStyle = rmxCss({
	backgroundColor: colors.surface,
	borderRadius: radius.lg,
	border: `1px solid ${colors.border}`,
	padding: responsive.spacingSection,
	boxShadow: shadows.sm,
})

const detailPageStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.xl,
})

const detailSectionsStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.lg,
})

const compactOutlineButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: `${spacing.xs} ${spacing.md}`,
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	color: colors.primary,
	backgroundColor: 'transparent',
	border: `1px solid ${colors.primary}`,
	borderRadius: radius.md,
	textDecoration: 'none',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.primarySoft,
	},
	[mq.mobile]: {
		flex: 1,
	},
})

const compactPrimaryButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: `${spacing.xs} ${spacing.md}`,
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	color: colors.background,
	backgroundColor: colors.primary,
	border: 'none',
	borderRadius: radius.md,
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.primaryHover,
	},
})

const compactDangerOutlineButtonStyle = rmxCss({
	padding: `${spacing.xs} ${spacing.md}`,
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	color: colors.error,
	backgroundColor: 'transparent',
	border: `1px solid ${colors.error}`,
	borderRadius: radius.md,
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: 'rgba(239, 68, 68, 0.1)',
	},
	[mq.mobile]: {
		flex: 1,
	},
})

const artworkFormStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	gap: spacing.sm,
	flexWrap: 'wrap',
})

const artworkFileInputStyle = rmxCss({
	fontSize: typography.fontSize.sm,
	color: colors.textMuted,
	maxWidth: '100%',
})

const detailGridStyle = rmxCss({
	display: 'grid',
	gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
	gap: spacing.md,
})

function renderMediaItemsSection(items: FeedDetailData['items']) {
	return (
		<section mix={detailCardStyle}>
			<h2 mix={sectionTitleStyle}>Media Items ({items.length})</h2>
			{items.length === 0 ? (
				<p mix={mutedStyle}>No media items yet.</p>
			) : (
				<div
					mix={rmxCss({
						overflowX: 'auto',
						overflowY: 'auto',
						maxHeight: '400px',
					})}
				>
					<table
						mix={rmxCss({
							width: '100%',
							borderCollapse: 'collapse',
							fontSize: typography.fontSize.sm,
						})}
					>
						<thead
							mix={rmxCss({
								position: 'sticky',
								top: 0,
								backgroundColor: colors.surface,
								zIndex: 1,
							})}
						>
							<tr mix={rmxCss({ borderBottom: `1px solid ${colors.border}` })}>
								<th mix={tableHeaderStyle}>#</th>
								<th mix={tableIconHeaderStyle} />
								<th mix={tableHeaderStyle}>Title</th>
								<th mix={responsiveTableHeaderStyle}>Author</th>
								<th mix={numericTableHeaderStyle}>Duration</th>
								<th mix={numericTableHeaderStyle}>Size</th>
								<th mix={tableIconHeaderStyle} />
							</tr>
						</thead>
						<tbody>
							{items.slice(0, 100).map((item, index) => {
								const { mediaRoot, relativePath } = parseMediaPath(item.path)
								return (
									<tr
										key={item.path}
										mix={rmxCss({
											borderBottom: `1px solid ${colors.border}`,
											'&:last-child': { borderBottom: 'none' },
											'&:hover': { backgroundColor: colors.background },
										})}
									>
										<td mix={indexTableCellStyle}>{index + 1}</td>
										<td mix={artworkTableCellStyle}>
											<img
												src={`/admin/api/artwork/${encodeURIComponent(mediaRoot)}/${encodeURIComponent(relativePath)}`}
												alt=""
												loading="lazy"
												mix={rmxCss({
													width: '32px',
													height: '32px',
													borderRadius: radius.sm,
													...artworkLayout.centeredContain,
													backgroundColor: colors.background,
												})}
											/>
										</td>
										<td title={item.title} mix={titleTableCellStyle}>
											{item.title}
										</td>
										<td
											title={item.author ?? undefined}
											mix={responsiveTableCellStyle}
										>
											{item.author || '—'}
										</td>
										<td mix={numericTableCellStyle}>
											{item.duration ? formatDuration(item.duration) : '—'}
										</td>
										<td mix={numericTableCellStyle}>
											{formatFileSize(item.sizeBytes)}
										</td>
										<td mix={actionTableCellStyle}>
											<a
												href={`/admin/media/${encodeURIComponent(mediaRoot)}/${encodeURIComponent(relativePath)}`}
												mix={smallPillLinkStyle}
											>
												View
											</a>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

const tableHeaderStyle = rmxCss({
	textAlign: 'left',
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	fontWeight: typography.fontWeight.medium,
	fontSize: typography.fontSize.xs,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
})

const responsiveTableHeaderStyle = rmxCss({
	textAlign: 'left',
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	fontWeight: typography.fontWeight.medium,
	fontSize: typography.fontSize.xs,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
	[mq.mobile]: { display: 'none' },
})

const numericTableHeaderStyle = rmxCss({
	textAlign: 'right',
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	fontWeight: typography.fontWeight.medium,
	fontSize: typography.fontSize.xs,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
	width: '80px',
	[mq.mobile]: { display: 'none' },
})

const tableIconHeaderStyle = rmxCss({
	width: '48px',
	padding: spacing.sm,
})

const indexTableCellStyle = rmxCss({
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	fontFamily: 'monospace',
	fontSize: typography.fontSize.xs,
})

const artworkTableCellStyle = rmxCss({
	padding: spacing.sm,
	textAlign: 'center',
})

const titleTableCellStyle = rmxCss({
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.text,
	maxWidth: '300px',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
})

const responsiveTableCellStyle = rmxCss({
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	maxWidth: '200px',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
	[mq.mobile]: { display: 'none' },
})

const numericTableCellStyle = rmxCss({
	padding: `${spacing.sm} ${spacing.md}`,
	color: colors.textMuted,
	textAlign: 'right',
	fontFamily: 'monospace',
	fontSize: typography.fontSize.xs,
	[mq.mobile]: { display: 'none' },
})

const actionTableCellStyle = rmxCss({
	padding: `${spacing.sm} ${spacing.md}`,
	textAlign: 'center',
})

const smallPillLinkStyle = rmxCss({
	display: 'inline-block',
	padding: `${spacing.xs} ${spacing.sm}`,
	fontSize: typography.fontSize.xs,
	fontWeight: typography.fontWeight.medium,
	color: colors.primary,
	backgroundColor: colors.primarySoft,
	borderRadius: radius.sm,
	textDecoration: 'none',
	'&:hover': {
		backgroundColor: colors.primarySoftHover,
	},
})

function renderAnalyticsSection(analytics: FeedDetailData['analytics']) {
	return (
		<section mix={detailCardStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: spacing.sm,
					marginBottom: spacing.md,
					flexWrap: 'wrap',
				})}
			>
				<h2 mix={rmxCss({ ...sectionTitleRules, margin: 0 })}>
					Analytics (last 30 days)
				</h2>
				<span
					mix={rmxCss({
						padding: `${spacing.xs} ${spacing.sm}`,
						fontSize: typography.fontSize.xs,
						fontWeight: typography.fontWeight.medium,
						color: colors.background,
						backgroundColor: colors.primary,
						border: `1px solid ${colors.primary}`,
						borderRadius: radius.sm,
					})}
				>
					30d
				</span>
			</div>
			<div
				mix={rmxCss({
					display: 'flex',
					flexDirection: 'column',
					gap: spacing.lg,
				})}
			>
				<div
					mix={rmxCss({
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
						gap: spacing.sm,
					})}
				>
					{renderStatCard('RSS fetches', analytics.summary.rssFetches)}
					{renderStatCard('Media requests', analytics.summary.mediaRequests)}
					{renderStatCard('Downloads', analytics.summary.downloadStarts)}
					{renderStatCard('Unique clients', analytics.summary.uniqueClients)}
					{renderStatCard(
						'Bytes served',
						formatFileSize(analytics.summary.bytesServed),
					)}
				</div>
				{renderTokenAnalyticsTable(analytics.byToken)}
				<div
					mix={rmxCss({
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
						gap: spacing.lg,
					})}
				>
					{renderTopClientsList(analytics.topClients)}
					{renderTopMediaItemsList(analytics.topMediaItems)}
					{renderDailyActivityChart(analytics.daily)}
				</div>
			</div>
		</section>
	)
}

function renderStatCard(label: string, value: string | number) {
	return (
		<div
			mix={rmxCss({
				padding: spacing.sm,
				borderRadius: radius.md,
				border: `1px solid ${colors.border}`,
				backgroundColor: colors.background,
			})}
		>
			<div
				mix={rmxCss({
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					marginBottom: spacing.xs,
				})}
			>
				{label}
			</div>
			<div
				mix={rmxCss({
					fontSize: typography.fontSize.base,
					fontWeight: typography.fontWeight.semibold,
					color: colors.text,
				})}
			>
				{value}
			</div>
		</div>
	)
}

function renderTokenAnalyticsTable(
	byToken: FeedDetailData['analytics']['byToken'],
) {
	return (
		<div>
			<h3 mix={analyticsSectionHeadingStyle}>By Token</h3>
			{byToken.length === 0 ? (
				<p mix={analyticsEmptyStyle}>No token analytics yet.</p>
			) : (
				<div mix={rmxCss({ overflowX: 'auto' })}>
					<table
						mix={rmxCss({
							width: '100%',
							borderCollapse: 'collapse',
							fontSize: typography.fontSize.xs,
						})}
					>
						<thead>
							<tr mix={rmxCss({ borderBottom: `1px solid ${colors.border}` })}>
								<th mix={analyticsCellHeaderStyle}>Token</th>
								<th mix={analyticsCellHeaderStyle}>RSS</th>
								<th mix={analyticsCellHeaderStyle}>Requests</th>
								<th mix={analyticsCellHeaderStyle}>Starts</th>
								<th mix={analyticsCellHeaderStyle}>Clients</th>
								<th mix={analyticsCellHeaderStyle}>Bytes</th>
								<th mix={analyticsCellHeaderStyle}>Last Seen</th>
							</tr>
						</thead>
						<tbody>
							{byToken.map((token) => (
								<tr
									key={token.token}
									mix={rmxCss({ borderBottom: `1px solid ${colors.border}` })}
								>
									<td mix={analyticsCellStyle}>
										<div>
											<div>{token.label || 'Unlabeled token'}</div>
											<div
												mix={rmxCss({
													color: colors.textMuted,
													fontFamily: 'monospace',
													fontSize: typography.fontSize.xs,
												})}
											>
												{token.token.slice(0, 10)}...
											</div>
										</div>
									</td>
									<td mix={analyticsCellStyle}>
										{token.rssFetches.toLocaleString()}
									</td>
									<td mix={analyticsCellStyle}>
										{token.mediaRequests.toLocaleString()}
									</td>
									<td mix={analyticsCellStyle}>
										{token.downloadStarts.toLocaleString()}
									</td>
									<td mix={analyticsCellStyle}>
										{token.uniqueClients.toLocaleString()}
									</td>
									<td mix={analyticsCellStyle}>
										{formatFileSize(token.bytesServed)}
									</td>
									<td mix={analyticsCellStyle}>
										{formatRelativeTime(token.lastSeenAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}

function renderTopClientsList(
	clients: FeedDetailData['analytics']['topClients'],
) {
	return (
		<div>
			<h3 mix={analyticsSectionHeadingStyle}>Top Clients</h3>
			{clients.length === 0 ? (
				<p mix={analyticsEmptyStyle}>No client analytics yet.</p>
			) : (
				<ul mix={analyticsCardListStyle}>
					{clients.slice(0, 8).map((client, index) => (
						<li
							key={`${client.clientName}-${client.lastSeenAt ?? 0}-${index}`}
							mix={analyticsCardListItemStyle}
						>
							<div
								mix={rmxCss({
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
									color: colors.text,
								})}
							>
								{client.clientName}
							</div>
							<div mix={analyticsMetaStyle}>
								<span>{client.downloadStarts} starts</span>
								<span>{client.mediaRequests} requests</span>
								<span>{client.uniqueClients} clients</span>
								<span>{formatFileSize(client.bytesServed)}</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

function renderTopMediaItemsList(
	items: FeedDetailData['analytics']['topMediaItems'],
) {
	return (
		<div>
			<h3 mix={analyticsSectionHeadingStyle}>Top Media Items</h3>
			{items.length === 0 ? (
				<p mix={analyticsEmptyStyle}>No media request analytics yet.</p>
			) : (
				<ul mix={analyticsCardListStyle}>
					{items.slice(0, 8).map((item) => (
						<li
							key={`${item.mediaRoot}:${item.relativePath}`}
							mix={analyticsCardListItemStyle}
						>
							<a
								href={`/admin/media/${encodeURIComponent(item.mediaRoot)}/${encodeURIComponent(item.relativePath)}`}
								mix={rmxCss({
									color: colors.primary,
									textDecoration: 'none',
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
								})}
							>
								{item.relativePath.split('/').at(-1) ?? item.relativePath}
							</a>
							<div mix={analyticsMetaStyle}>
								<span>{item.downloadStarts} starts</span>
								<span>{item.mediaRequests} requests</span>
								<span>{formatFileSize(item.bytesServed)}</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

function renderDailyActivityChart(daily: FeedDetailData['analytics']['daily']) {
	const visibleDaily = daily.slice(-14)
	const maxDailyRequests = Math.max(
		1,
		...visibleDaily.map((point) => point.mediaRequests),
	)

	return (
		<div>
			<h3 mix={analyticsSectionHeadingStyle}>Daily Activity</h3>
			{daily.length === 0 ? (
				<p mix={analyticsEmptyStyle}>No daily activity yet.</p>
			) : (
				<div
					mix={rmxCss({
						display: 'flex',
						flexDirection: 'column',
						gap: spacing.xs,
					})}
				>
					{visibleDaily.map((point) => (
						<div
							key={point.day}
							mix={rmxCss({
								display: 'grid',
								gridTemplateColumns: '68px 1fr 52px',
								alignItems: 'center',
								gap: spacing.sm,
							})}
						>
							<span
								mix={rmxCss({
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									fontFamily: 'monospace',
								})}
							>
								{point.day.slice(5)}
							</span>
							<div
								mix={rmxCss({
									height: '8px',
									borderRadius: radius.sm,
									backgroundColor: colors.background,
									overflow: 'hidden',
								})}
							>
								<div
									mix={rmxCss({
										height: '100%',
										width: `${Math.max(2, (point.mediaRequests / maxDailyRequests) * 100)}%`,
										backgroundColor: colors.primary,
									})}
								/>
							</div>
							<span
								mix={rmxCss({
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									textAlign: 'right',
								})}
							>
								{point.mediaRequests}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

const analyticsSectionHeadingStyle = rmxCss({
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.semibold,
	margin: `0 0 ${spacing.sm} 0`,
	color: colors.text,
})

const analyticsEmptyStyle = rmxCss({
	margin: 0,
	fontSize: typography.fontSize.sm,
	color: colors.textMuted,
})

const analyticsCardListStyle = rmxCss({
	listStyle: 'none',
	padding: 0,
	margin: 0,
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.sm,
})

const analyticsCardListItemStyle = rmxCss({
	padding: spacing.sm,
	borderRadius: radius.md,
	border: `1px solid ${colors.border}`,
	backgroundColor: colors.background,
})

const analyticsMetaStyle = rmxCss({
	marginTop: spacing.xs,
	fontSize: typography.fontSize.xs,
	color: colors.textMuted,
	display: 'flex',
	gap: spacing.sm,
	flexWrap: 'wrap',
})

const analyticsCellHeaderStyle = rmxCss({
	textAlign: 'left',
	padding: `${spacing.xs} ${spacing.sm}`,
	color: colors.textMuted,
	fontWeight: typography.fontWeight.medium,
	fontSize: typography.fontSize.xs,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
})

const analyticsCellStyle = rmxCss({
	padding: `${spacing.xs} ${spacing.sm}`,
	fontSize: typography.fontSize.xs,
	color: colors.text,
})

function renderTokensSection(feed: Feed, tokens: Array<FeedTokenSummary>) {
	return (
		<section mix={detailCardStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: spacing.md,
					marginBottom: spacing.lg,
				})}
			>
				<h2 mix={rmxCss({ ...sectionTitleRules, margin: 0 })}>
					Access Tokens ({tokens.length})
				</h2>
				<form method="post" action={`/admin/feeds/${feed.id}`}>
					<input type="hidden" name="_action" value="create-token" />
					<button type="submit" mix={buttonStyle}>
						+ New Token
					</button>
				</form>
			</div>
			{tokens.length === 0 ? (
				<div
					mix={rmxCss({
						textAlign: 'center',
						padding: spacing.xl,
						color: colors.textMuted,
					})}
				>
					<p mix={rmxCss({ margin: 0 })}>
						No tokens yet. Create one to share this feed.
					</p>
				</div>
			) : (
				<div
					mix={rmxCss({
						display: 'flex',
						flexDirection: 'column',
						gap: spacing.sm,
					})}
				>
					{tokens.map((token) => (
						<div
							key={token.token}
							mix={rmxCss({
								display: 'flex',
								alignItems: 'center',
								gap: spacing.md,
								backgroundColor: colors.background,
								padding: spacing.md,
								border: `1px solid ${colors.border}`,
								borderRadius: radius.md,
							})}
						>
							<div mix={rmxCss({ flex: 1, minWidth: 0 })}>
								<div
									mix={rmxCss({
										fontSize: typography.fontSize.sm,
										fontWeight: typography.fontWeight.medium,
										color: colors.text,
										marginBottom: spacing.xs,
									})}
								>
									{token.label || 'Unlabeled token'}
								</div>
								<div
									mix={rmxCss({
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										display: 'flex',
										gap: spacing.md,
										flexWrap: 'wrap',
									})}
								>
									<span>
										Created {formatDate(token.createdAt, { style: 'short' })}
									</span>
									<span>Last used: {formatRelativeTime(token.lastUsedAt)}</span>
								</div>
							</div>
							<div mix={rmxCss({ display: 'flex', gap: spacing.sm })}>
								<a href={`/feed/${token.token}`} mix={tokenActionStyle}>
									Open URL
								</a>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	)
}

const tokenActionStyle = rmxCss({
	padding: `${spacing.xs} ${spacing.sm}`,
	fontSize: typography.fontSize.xs,
	fontWeight: typography.fontWeight.medium,
	color: colors.primary,
	backgroundColor: 'transparent',
	border: `1px solid ${colors.primary}`,
	borderRadius: radius.sm,
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	textDecoration: 'none',
	'&:hover': {
		backgroundColor: colors.primarySoft,
	},
})

function renderDirectoryFeedDetails(feed: DirectoryFeed) {
	const paths = parseDirectoryPaths(feed)

	return (
		<section mix={cardStyle}>
			<h2>Directories</h2>
			{paths.length === 0 ? (
				<p mix={mutedStyle}>No directories configured.</p>
			) : (
				<ul>
					{paths.map((pathValue) => (
						<li key={pathValue}>{pathValue}</li>
					))}
				</ul>
			)}
		</section>
	)
}

function renderCuratedItems(
	feed: Feed,
	items: Awaited<ReturnType<typeof getItemsForFeed>>,
	media: Awaited<ReturnType<typeof scanAllMediaRoots>>,
) {
	return (
		<section mix={cardStyle}>
			<h2>Items</h2>
			<form method="post" action={`/admin/feeds/${feed.id}`} mix={rowStyle}>
				<input type="hidden" name="_action" value="add-item" />
				<input type="hidden" name="feedId" value={feed.id} />
				<label mix={labelStyle}>
					Add media item
					<select name="mediaPath" required mix={inputStyle}>
						<option value="">Select media...</option>
						{media.slice(0, 500).map((file) => (
							<option key={file.path} value={file.path}>
								{file.title} ({file.path})
							</option>
						))}
					</select>
				</label>
				<button type="submit" mix={buttonStyle}>
					Add item
				</button>
			</form>
			{items.length === 0 ? (
				<p mix={mutedStyle}>No curated items yet.</p>
			) : (
				<ol>
					{items.map((item) => {
						const mediaPath = createMediaKey(item.mediaRoot, item.relativePath)
						return (
							<li key={item.id}>
								<span>{mediaPath}</span>
								<form
									method="post"
									action={`/admin/feeds/${feed.id}`}
									mix={rmxCss({ display: 'inline', marginLeft: '0.75rem' })}
								>
									<input type="hidden" name="_action" value="remove-item" />
									<input type="hidden" name="feedId" value={feed.id} />
									<input type="hidden" name="mediaPath" value={mediaPath} />
									<button type="submit" mix={secondaryButtonStyle}>
										Remove
									</button>
								</form>
							</li>
						)
					})}
				</ol>
			)}
			{items.length > 0 ? (
				<form method="post" action={`/admin/feeds/${feed.id}`}>
					<input type="hidden" name="_action" value="clear-items" />
					<input type="hidden" name="feedId" value={feed.id} />
					<button type="submit" mix={dangerButtonStyle}>
						Clear all items
					</button>
				</form>
			) : null}
		</section>
	)
}

async function renderVersionPage() {
	const versionInfo = await getVersionInfo()
	const githubRepo = getGitHubRepo()
	const displayVersion =
		versionInfo.version ?? versionInfo.commit?.shortHash ?? 'Unknown'

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>Version Information</h1>
			</div>
			<section mix={cardStyle}>
				<dl>
					{renderDescriptionRow('Version', displayVersion)}
					{versionInfo.commit
						? renderDescriptionRow(
								'Commit',
								`${versionInfo.commit.shortHash} - ${versionInfo.commit.message.split('\n')[0]}`,
							)
						: null}
					{versionInfo.commit
						? renderDescriptionRow(
								'Commit date',
								formatDate(versionInfo.commit.date),
							)
						: null}
					{renderDescriptionRow('Started', formatDate(versionInfo.startTime))}
					{renderDescriptionRow(
						'Uptime',
						formatDuration(versionInfo.uptimeMs / 1000),
					)}
					{githubRepo ? renderDescriptionRow('GitHub', githubRepo) : null}
				</dl>
			</section>
		</div>
	)
}

async function renderMediaIndex(url: URL) {
	const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
	const files = await scanAllMediaRoots()
	const filteredFiles = query
		? files.filter((file) =>
				[file.title, file.author, file.filename, file.path]
					.filter(Boolean)
					.some((value) => value!.toLowerCase().includes(query)),
			)
		: files

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<h1 mix={rmxCss({ margin: 0 })}>Media</h1>
			</div>
			<form method="get" action="/admin/media" mix={cardStyle}>
				<label mix={labelStyle}>
					Search media
					<input
						name="q"
						value={query}
						placeholder="Title, author, filename"
						mix={inputStyle}
					/>
				</label>
				<button type="submit" mix={buttonStyle}>
					Search
				</button>
			</form>
			<section mix={cardStyle}>
				<h2>{filteredFiles.length} media item(s)</h2>
				{filteredFiles.length === 0 ? (
					<p mix={mutedStyle}>No media found.</p>
				) : (
					<ul>
						{filteredFiles.slice(0, 250).map((file) => (
							<li key={file.path}>
								<a href={`/admin/media/${encodeURIComponent(file.path)}`}>
									{file.title}
								</a>{' '}
								<span mix={mutedStyle}>
									{file.author ? `by ${file.author} · ` : ''}
									{formatFileSize(file.sizeBytes)}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	)
}

function getEditFallback(mediaPath: string) {
	if (
		!mediaPath.endsWith(EDIT_SUFFIX) ||
		mediaPath.length <= EDIT_SUFFIX.length
	) {
		return null
	}
	return mediaPath.slice(0, -EDIT_SUFFIX.length)
}

function renderMediaDetailFromFiles(
	files: Awaited<ReturnType<typeof scanAllMediaRoots>>,
	mediaPath: string,
) {
	const file = files.find((item) => item.path === mediaPath)

	if (!file) return null

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin/media" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>{file.title}</h1>
			</div>
			<section mix={cardStyle}>
				<dl>
					{renderDescriptionRow('Path', file.path)}
					{renderDescriptionRow('Filename', file.filename)}
					{renderDescriptionRow('Author', file.author ?? 'Unknown')}
					{renderDescriptionRow(
						'Duration',
						file.duration ? formatDuration(file.duration) : 'Unknown',
					)}
					{renderDescriptionRow('Size', formatFileSize(file.sizeBytes))}
					{renderDescriptionRow(
						'Modified',
						new Date(file.fileModifiedAt).toLocaleString(),
					)}
				</dl>
			</section>
		</div>
	)
}

async function renderMediaDetailPage(
	mediaPath: string,
	pageOptions: { request: Request; target: string | null },
	fallbackMediaPath: string | null = null,
) {
	const files = await scanAllMediaRoots()
	const body =
		renderMediaDetailFromFiles(files, mediaPath) ??
		(fallbackMediaPath
			? renderMediaDetailFromFiles(files, fallbackMediaPath)
			: null)
	return renderAdminPage({
		title: body ? 'Media Detail' : 'Media Not Found',
		body: body ?? (
			<section mix={cardStyle}>
				<h1>Media not found</h1>
				<p>{mediaPath}</p>
				<a href="/admin/media" mix={buttonStyle}>
					Back to media
				</a>
			</section>
		),
		status: body ? 200 : 404,
		...pageOptions,
	})
}

function renderFeedFields(
	sortFields: string,
	sortOrder: 'asc' | 'desc',
	feedType: FeedType,
	feed?: Feed,
) {
	return (
		<div mix={stackStyle}>
			<label mix={labelStyle}>
				Name
				<input name="name" required value={feed?.name ?? ''} mix={inputStyle} />
			</label>
			<label mix={labelStyle}>
				Description
				<textarea name="description" rows={3} mix={inputStyle}>
					{feed?.description ?? ''}
				</textarea>
			</label>
			<label mix={labelStyle}>
				Subtitle
				<input name="subtitle" value={feed?.subtitle ?? ''} mix={inputStyle} />
			</label>
			<div mix={gridStyle}>
				<label mix={labelStyle}>
					Sort field
					<input name="sortFields" value={sortFields} mix={inputStyle} />
				</label>
				<label mix={labelStyle}>
					Sort order
					<select name="sortOrder" mix={inputStyle}>
						<option value="asc" selected={sortOrder === 'asc'}>
							Ascending
						</option>
						<option value="desc" selected={sortOrder === 'desc'}>
							Descending
						</option>
					</select>
				</label>
			</div>
			<label mix={labelStyle}>
				Feed type
				<select name="feedType" mix={inputStyle}>
					<option value="episodic" selected={feedType === 'episodic'}>
						Episodic
					</option>
					<option value="serial" selected={feedType === 'serial'}>
						Serial
					</option>
				</select>
			</label>
			<label mix={labelStyle}>
				Link
				<input name="link" value={feed?.link ?? ''} mix={inputStyle} />
			</label>
			<label mix={labelStyle}>
				Copyright
				<input
					name="copyright"
					value={feed?.copyright ?? ''}
					mix={inputStyle}
				/>
			</label>
		</div>
	)
}

function renderInfoItem(
	label: string,
	value: string,
	options: { mono?: boolean; href?: string } = {},
) {
	const { mono = false, href } = options
	return (
		<div key={label}>
			<dt
				mix={rmxCss({
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					marginBottom: spacing.xs,
				})}
			>
				{label}
			</dt>
			<dd
				mix={rmxCss({
					fontSize: typography.fontSize.sm,
					color: colors.text,
					margin: 0,
					fontFamily: mono ? 'monospace' : 'inherit',
					wordBreak: mono ? 'break-all' : 'normal',
				})}
			>
				{href ? (
					<a
						href={href}
						target="_blank"
						rel="noreferrer"
						mix={rmxCss({
							color: colors.primary,
							textDecoration: 'none',
							fontFamily: mono ? 'monospace' : 'inherit',
							wordBreak: mono ? 'break-all' : 'normal',
							'&:hover': { textDecoration: 'underline' },
						})}
					>
						{value}
					</a>
				) : (
					value
				)}
			</dd>
		</div>
	)
}

function renderDirectoriesInfo(paths: Array<string>) {
	return (
		<div
			key="directories"
			mix={rmxCss({ gridColumn: paths.length > 1 ? '1 / -1' : undefined })}
		>
			<dt
				mix={rmxCss({
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					marginBottom: spacing.xs,
				})}
			>
				{paths.length === 1 ? 'Directory' : `Directories (${paths.length})`}
			</dt>
			<dd mix={rmxCss({ margin: 0 })}>
				{paths.length === 0 ? (
					<span
						mix={rmxCss({
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
						})}
					>
						No directories configured
					</span>
				) : paths.length === 1 ? (
					<span
						mix={rmxCss({
							fontSize: typography.fontSize.sm,
							color: colors.text,
							fontFamily: 'monospace',
							wordBreak: 'break-all',
						})}
					>
						{paths[0]}
					</span>
				) : (
					<ul
						mix={rmxCss({
							listStyle: 'none',
							padding: 0,
							margin: 0,
							display: 'flex',
							flexDirection: 'column',
							gap: spacing.xs,
						})}
					>
						{paths.map((path) => (
							<li
								key={path}
								mix={rmxCss({
									fontSize: typography.fontSize.sm,
									color: colors.text,
									fontFamily: 'monospace',
									wordBreak: 'break-all',
									padding: `${spacing.xs} ${spacing.sm}`,
									backgroundColor: colors.background,
									borderRadius: radius.sm,
									border: `1px solid ${colors.border}`,
								})}
							>
								{path}
							</li>
						))}
					</ul>
				)}
			</dd>
		</div>
	)
}

function renderDescriptionRow(label: string, value: RemixNode) {
	return (
		<div
			key={label}
			mix={rmxCss({
				display: 'grid',
				gridTemplateColumns: 'minmax(8rem, 12rem) 1fr',
				gap: '1rem',
				padding: '0.5rem 0',
				borderBottom: `1px solid ${colors.border}`,
			})}
		>
			<dt mix={rmxCss({ fontWeight: '700' })}>{label}</dt>
			<dd mix={rmxCss({ margin: 0 })}>{value}</dd>
		</div>
	)
}

async function getFeedSummaries(): Promise<Array<FeedSummary>> {
	const directoryFeeds = await Promise.all(
		(await listDirectoryFeeds()).map(async (feed) => {
			const tokens = await listActiveDirectoryFeedTokens(feed.id)
			const directoryPaths = parseDirectoryPaths(feed)
			let itemCount = 0
			for (const mediaPath of directoryPaths) {
				const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
				const absolutePath = toAbsolutePath(mediaRoot, relativePath)
				if (!absolutePath) continue
				itemCount += (await scanDirectory(absolutePath)).length
			}
			return {
				id: feed.id,
				name: feed.name,
				description: feed.description,
				type: 'directory' as const,
				itemCount,
				tokenCount: tokens.length,
				lastAccessedAt: getLastAccessedAt(tokens),
				updatedAt: feed.updatedAt,
				directoryPaths,
			}
		}),
	)
	const curatedFeeds = await Promise.all(
		(await listCuratedFeeds()).map(async (feed) => {
			const tokens = await listActiveCuratedFeedTokens(feed.id)
			return {
				id: feed.id,
				name: feed.name,
				description: feed.description,
				type: 'curated' as const,
				itemCount: (await getItemsForFeed(feed.id)).length,
				tokenCount: tokens.length,
				lastAccessedAt: getLastAccessedAt(tokens),
				updatedAt: feed.updatedAt,
			}
		}),
	)
	return [...directoryFeeds, ...curatedFeeds].sort(
		(a, b) => b.updatedAt - a.updatedAt,
	)
}

function getLastAccessedAt(tokens: Array<{ lastUsedAt: number | null }>) {
	const usedTokens = tokens.filter((token) => token.lastUsedAt !== null)
	if (usedTokens.length === 0) return null
	return Math.max(...usedTokens.map((token) => token.lastUsedAt!))
}

function normalizePath(pathname: string) {
	return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}
