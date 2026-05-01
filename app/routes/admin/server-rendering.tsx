import { css as rmxCss, type RemixNode } from 'remix/ui'
import {
	getGitHubRepo,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import { getCuratedFeedById, listCuratedFeeds } from '#app/db/curated-feeds.ts'
import {
	getDirectoryFeedById,
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
} from '#app/helpers/format.ts'
import { scanAllMediaRoots, scanDirectory } from '#app/helpers/media.ts'
import { createMediaKey } from '#app/helpers/path-parsing.ts'
import { getVersionInfo } from '#app/helpers/version.ts'
import { colors, mq, spacing, typography } from '#app/styles/tokens.ts'
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
import { renderAdminPage } from './admin-utils.tsx'

type FeedSummary = {
	id: string
	name: string
	description: string
	type: 'directory' | 'curated'
	itemCount: number
	updatedAt: number
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

	if (path === '/admin') {
		return renderAdminPage({
			title: 'MediaRSS Admin',
			body: await renderFeedIndex(),
		})
	}

	if (path === '/admin/version') {
		return renderAdminPage({
			title: 'Version Information',
			body: await renderVersionPage(),
			isVersionPage: true,
		})
	}

	if (path === '/admin/feeds/new') {
		return renderAdminPage({
			title: 'New Feed',
			body: await renderNewFeedPage(),
		})
	}

	const feedMatch = /^\/admin\/feeds\/([^/]+)(?:\/edit)?$/.exec(path)
	if (feedMatch?.[1]) {
		return renderFeedPage(feedMatch[1])
	}

	if (path === '/admin/media') {
		return renderAdminPage({
			title: 'Media',
			body: await renderMediaIndex(url),
		})
	}

	const mediaMatch = /^\/admin\/media\/(.+?)(?:\/edit)?$/.exec(path)
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
			})
		}
		return renderMediaDetailPage(mediaPath)
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
						<article key={feed.id} mix={cardStyle}>
							<h2>{feed.name}</h2>
							<p mix={mutedStyle}>{feed.description || 'No description.'}</p>
							<p>
								<strong>{feed.type}</strong> · {feed.itemCount} item
								{feed.itemCount === 1 ? '' : 's'}
							</p>
							<p mix={mutedStyle}>Updated {formatDate(feed.updatedAt)}</p>
							<a href={`/admin/feeds/${feed.id}`} mix={buttonStyle}>
								Manage
							</a>
						</article>
					))}
				</section>
			)}
		</div>
	)
}

async function renderNewFeedPage() {
	const media = await scanAllMediaRoots()
	const mediaOptions = media.slice(0, 200)

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<a href="/admin" mix={secondaryButtonStyle}>
					Back
				</a>
				<h1 mix={rmxCss({ margin: 0 })}>New Feed</h1>
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

async function renderFeedPage(feedId: string) {
	const feed = await getFeed(feedId)
	if (!feed) {
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
		})
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
	})
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

async function renderMediaDetail(mediaPath: string) {
	const files = await scanAllMediaRoots()
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

async function renderMediaDetailPage(mediaPath: string) {
	const body = await renderMediaDetail(mediaPath)
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
				borderBottom: '1px solid #e2e8f0',
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
			let itemCount = 0
			for (const mediaPath of parseDirectoryPaths(feed)) {
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
				updatedAt: feed.updatedAt,
			}
		}),
	)
	const curatedFeeds = await Promise.all(
		(await listCuratedFeeds()).map(async (feed) => ({
			id: feed.id,
			name: feed.name,
			description: feed.description,
			type: 'curated' as const,
			itemCount: (await getItemsForFeed(feed.id)).length,
			updatedAt: feed.updatedAt,
		})),
	)
	return [...directoryFeeds, ...curatedFeeds].sort(
		(a, b) => b.updatedAt - a.updatedAt,
	)
}

async function getFeed(feedId: string): Promise<Feed | undefined> {
	return (
		(await getDirectoryFeedById(feedId)) ?? (await getCuratedFeedById(feedId))
	)
}

function normalizePath(pathname: string) {
	return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}
