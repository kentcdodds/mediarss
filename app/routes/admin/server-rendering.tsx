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
	getFeedAnalyticsSummary,
	getFeedDailyAnalytics,
	getFeedTopClientAnalytics,
	getFeedTopMediaItemAnalytics,
} from '#app/db/feed-analytics-events.ts'
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
	shadows,
	spacing,
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

type FeedDetailData = {
	feed: Feed
	isDirectory: boolean
	tokens: Array<FeedTokenSummary>
	items: Awaited<ReturnType<typeof getDirectoryFeedItems>>
	analytics: {
		summary: ReturnType<typeof getFeedAnalyticsSummary>
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

	return {
		feed,
		isDirectory,
		tokens,
		items,
		analytics: {
			summary: getFeedAnalyticsSummary(feed.id, since),
			topClients: getFeedTopClientAnalytics(feed.id, since),
			topMediaItems: getFeedTopMediaItemAnalytics(feed.id, since),
			daily: getFeedDailyAnalytics(feed.id, since),
		},
	}
}

function renderFeedDetail(detail: FeedDetailData) {
	const { feed, isDirectory, items, tokens, analytics } = detail
	const directoryPaths = isDirectoryFeed(feed) ? parseDirectoryPaths(feed) : []
	return (
		<div mix={stackStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: spacing.md,
					flexWrap: 'wrap',
				})}
			>
				<div mix={rowStyle}>
					<a href="/admin" mix={secondaryButtonStyle}>
						Back
					</a>
					<h1 mix={rmxCss({ margin: 0 })}>{feed.name}</h1>
				</div>
				<div mix={rowStyle}>
					<a href={`/admin/feeds/${feed.id}/edit`} mix={secondaryButtonStyle}>
						Edit Feed
					</a>
					<form method="post" action={`/admin/feeds/${feed.id}`}>
						<input type="hidden" name="_action" value="delete-feed" />
						<input type="hidden" name="feedId" value={feed.id} />
						<button type="submit" mix={dangerButtonStyle}>
							Delete
						</button>
					</form>
				</div>
			</div>

			<section mix={cardStyle}>
				<h2 mix={sectionTitleStyle}>Feed Details</h2>
				<p mix={rmxCss({ color: colors.textMuted, marginTop: 0 })}>
					{feed.description || 'No description.'}
				</p>
				<div mix={detailGridStyle}>
					{renderDescriptionRow('ID', feed.id)}
					{renderDescriptionRow('Feed Type', feed.feedType ?? 'episodic')}
					{renderDescriptionRow('Kind', isDirectory ? 'Directory' : 'Curated')}
					{renderDescriptionRow('Sort', `${feed.sortOrder}:${feed.sortFields}`)}
					{renderDescriptionRow('Author', feed.author ?? '—')}
					{renderDescriptionRow('Language', feed.language)}
					{renderDescriptionRow('Created', formatDate(feed.createdAt))}
					{renderDescriptionRow('Updated', formatDate(feed.updatedAt))}
					{renderDescriptionRow('Link', feed.link ?? '—')}
					{renderDescriptionRow('Copyright', feed.copyright ?? '—')}
				</div>
				{isDirectory ? (
					<div mix={rmxCss({ marginTop: spacing.md })}>
						<strong>Directories</strong>
						<ul>
							{directoryPaths.map((path) => (
								<li key={path}>
									<code>{path}</code>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</section>

			<section mix={cardStyle}>
				<h2 mix={sectionTitleStyle}>Feed Artwork</h2>
				<div mix={rowStyle}>
					<img
						src={`/admin/api/feeds/${feed.id}/artwork`}
						alt=""
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
						<p mix={mutedStyle}>Current artwork for this feed.</p>
						<p mix={mutedStyle}>
							Artwork upload remains available through the enhanced admin UI.
						</p>
					</div>
				</div>
			</section>

			{renderMediaItemsSection(items)}
			{renderAnalyticsSection(analytics)}
			{renderTokensSection(feed, tokens)}
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

const detailGridStyle = rmxCss({
	display: 'grid',
	gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
	gap: spacing.md,
})

function renderMediaItemsSection(items: FeedDetailData['items']) {
	return (
		<section mix={cardStyle}>
			<h2 mix={sectionTitleStyle}>Media Items ({items.length})</h2>
			{items.length === 0 ? (
				<p mix={mutedStyle}>No media items yet.</p>
			) : (
				<div mix={rmxCss({ overflowX: 'auto' })}>
					<table
						mix={rmxCss({
							width: '100%',
							borderCollapse: 'collapse',
							fontSize: typography.fontSize.sm,
						})}
					>
						<thead>
							<tr>
								<th mix={tableHeaderStyle}>#</th>
								<th mix={tableHeaderStyle}>Title</th>
								<th mix={tableHeaderStyle}>Author</th>
								<th mix={tableHeaderStyle}>Duration</th>
								<th mix={tableHeaderStyle}>Size</th>
								<th mix={tableHeaderStyle}>Modified</th>
							</tr>
						</thead>
						<tbody>
							{items.slice(0, 100).map((item, index) => (
								<tr key={item.path}>
									<td mix={tableCellStyle}>{index + 1}</td>
									<td mix={tableCellStyle}>{item.title}</td>
									<td mix={tableCellStyle}>{item.author ?? '—'}</td>
									<td mix={tableCellStyle}>
										{item.duration ? formatDuration(item.duration) : '—'}
									</td>
									<td mix={tableCellStyle}>{formatFileSize(item.sizeBytes)}</td>
									<td mix={tableCellStyle}>
										{formatDate(item.fileModifiedAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

const tableHeaderStyle = rmxCss({
	textAlign: 'left',
	padding: spacing.sm,
	color: colors.textMuted,
	borderBottom: `1px solid ${colors.border}`,
	fontWeight: typography.fontWeight.medium,
})

const tableCellStyle = rmxCss({
	padding: spacing.sm,
	borderBottom: `1px solid ${colors.border}`,
	verticalAlign: 'top',
})

function renderAnalyticsSection(analytics: FeedDetailData['analytics']) {
	return (
		<section mix={cardStyle}>
			<div
				mix={rmxCss({
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: spacing.md,
					marginBottom: spacing.md,
				})}
			>
				<h2 mix={rmxCss({ ...sectionTitleRules, margin: 0 })}>
					Analytics (last 30 days)
				</h2>
				<span mix={buttonStyle}>30d</span>
			</div>
			<div mix={detailGridStyle}>
				{renderStatCard('RSS fetches', analytics.summary.rssFetches)}
				{renderStatCard('Media requests', analytics.summary.mediaRequests)}
				{renderStatCard('Downloads', analytics.summary.downloadStarts)}
				{renderStatCard('Unique clients', analytics.summary.uniqueClients)}
				{renderStatCard(
					'Bytes served',
					formatFileSize(analytics.summary.bytesServed),
				)}
			</div>
			<div
				mix={rmxCss({
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
					gap: spacing.lg,
					marginTop: spacing.lg,
				})}
			>
				{renderAnalyticsList(
					'Top clients',
					analytics.topClients.map((client) => ({
						label: client.clientName,
						value: `${client.mediaRequests} requests`,
					})),
				)}
				{renderAnalyticsList(
					'Top media items',
					analytics.topMediaItems.map((item) => ({
						label: createMediaKey(item.mediaRoot, item.relativePath),
						value: `${item.mediaRequests} requests`,
					})),
				)}
				{renderAnalyticsList(
					'Daily activity',
					analytics.daily.map((day) => ({
						label: day.day,
						value: `${day.mediaRequests} requests`,
					})),
				)}
			</div>
		</section>
	)
}

function renderStatCard(label: string, value: string | number) {
	return (
		<div
			mix={rmxCss({
				border: `1px solid ${colors.border}`,
				borderRadius: radius.md,
				padding: spacing.md,
				backgroundColor: colors.background,
			})}
		>
			<div
				mix={rmxCss({
					fontSize: typography.fontSize.xs,
					color: colors.textMuted,
				})}
			>
				{label}
			</div>
			<strong>{value}</strong>
		</div>
	)
}

function renderAnalyticsList(
	title: string,
	rows: Array<{ label: string; value: string }>,
) {
	return (
		<div>
			<h3 mix={rmxCss({ fontSize: typography.fontSize.sm })}>{title}</h3>
			{rows.length === 0 ? (
				<p mix={mutedStyle}>No data yet.</p>
			) : (
				<ul mix={rmxCss({ padding: 0, listStyle: 'none' })}>
					{rows.slice(0, 8).map((row) => (
						<li
							key={`${row.label}:${row.value}`}
							mix={rmxCss({
								display: 'flex',
								justifyContent: 'space-between',
								gap: spacing.md,
								padding: `${spacing.xs} 0`,
								borderBottom: `1px solid ${colors.border}`,
							})}
						>
							<span>{row.label}</span>
							<span mix={mutedStyle}>{row.value}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

function renderTokensSection(feed: Feed, tokens: Array<FeedTokenSummary>) {
	return (
		<section mix={cardStyle}>
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
				<p mix={mutedStyle}>No access tokens yet.</p>
			) : (
				<div mix={stackStyle}>
					{tokens.map((token) => (
						<div
							key={token.token}
							mix={rmxCss({
								display: 'flex',
								justifyContent: 'space-between',
								gap: spacing.md,
								padding: spacing.md,
								border: `1px solid ${colors.border}`,
								borderRadius: radius.md,
							})}
						>
							<div>
								<strong>{token.label || 'Default'}</strong>
								<div mix={mutedStyle}>
									Created {formatDate(token.createdAt)}
									{' · '}
									{token.lastUsedAt
										? `Last used ${formatRelativeTime(token.lastUsedAt)}`
										: 'Never used'}
								</div>
							</div>
							<a href={`/feed/${token.token}`} mix={secondaryButtonStyle}>
								Open URL
							</a>
						</div>
					))}
				</div>
			)}
		</section>
	)
}

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
