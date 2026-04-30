import { redirect } from 'remix/response/redirect'
import { css as rmxCss, type RemixNode } from 'remix/ui'
import {
	getGitHubRepo,
	parseMediaPath,
	toAbsolutePath,
} from '#app/config/env.ts'
import { createCuratedFeedToken } from '#app/db/curated-feed-tokens.ts'
import {
	createCuratedFeed,
	deleteCuratedFeed,
	getCuratedFeedById,
	listCuratedFeeds,
	updateCuratedFeed,
} from '#app/db/curated-feeds.ts'
import { createDirectoryFeedToken } from '#app/db/directory-feed-tokens.ts'
import {
	createDirectoryFeed,
	deleteDirectoryFeed,
	getDirectoryFeedById,
	listDirectoryFeeds,
	parseDirectoryPaths,
	updateDirectoryFeed,
} from '#app/db/directory-feeds.ts'
import {
	addItemToFeed,
	clearFeedItems,
	getItemsForFeed,
	removeItemFromFeed,
} from '#app/db/feed-items.ts'
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
import { ServerDocument } from '#app/components/server-document.tsx'
import { renderUi } from '#app/helpers/render.ts'

type AdminPageOptions = {
	title: string
	body: RemixNode
	status?: number
}

type FeedSummary = {
	id: string
	name: string
	description: string
	type: 'directory' | 'curated'
	itemCount: number
	updatedAt: number
}

type FormFeedData = {
	name: string
	description: string
	subtitle: string | null
	sortFields: string
	sortOrder: 'asc' | 'desc'
	feedType: FeedType
	link: string | null
	copyright: string | null
}

const pageStyle = rmxCss({
	fontFamily:
		'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	minHeight: '100vh',
	backgroundColor: '#f8fafc',
	color: '#0f172a',
})

const headerStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '1rem',
	padding: '1rem clamp(1rem, 3vw, 2rem)',
	borderBottom: '1px solid #e2e8f0',
	backgroundColor: '#ffffff',
})

const navStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	gap: '0.75rem',
	flexWrap: 'wrap',
})

const mainStyle = rmxCss({
	maxWidth: '1180px',
	margin: '0 auto',
	padding: 'clamp(1rem, 3vw, 2rem)',
})

const cardStyle = rmxCss({
	backgroundColor: '#ffffff',
	border: '1px solid #e2e8f0',
	borderRadius: '0.75rem',
	padding: '1rem',
	boxShadow: '0 1px 2px rgb(15 23 42 / 0.04)',
})

const gridStyle = rmxCss({
	display: 'grid',
	gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
	gap: '1rem',
})

const stackStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: '1rem',
})

const rowStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	gap: '0.75rem',
	flexWrap: 'wrap',
})

const labelStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: '0.35rem',
	fontSize: '0.875rem',
	fontWeight: '600',
})

const inputStyle = rmxCss({
	width: '100%',
	boxSizing: 'border-box',
	border: '1px solid #cbd5e1',
	borderRadius: '0.5rem',
	padding: '0.65rem',
	font: 'inherit',
	backgroundColor: '#ffffff',
})

const buttonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	border: '1px solid #2563eb',
	borderRadius: '0.5rem',
	padding: '0.55rem 0.85rem',
	backgroundColor: '#2563eb',
	color: '#ffffff',
	font: 'inherit',
	fontWeight: '600',
	textDecoration: 'none',
	cursor: 'pointer',
})

const secondaryButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	border: '1px solid #cbd5e1',
	borderRadius: '0.5rem',
	padding: '0.55rem 0.85rem',
	backgroundColor: '#ffffff',
	color: '#0f172a',
	font: 'inherit',
	fontWeight: '600',
	textDecoration: 'none',
	cursor: 'pointer',
})

const dangerButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	border: '1px solid #dc2626',
	borderRadius: '0.5rem',
	padding: '0.55rem 0.85rem',
	backgroundColor: '#dc2626',
	color: '#ffffff',
	font: 'inherit',
	fontWeight: '600',
	cursor: 'pointer',
})

const mutedStyle = rmxCss({
	color: '#64748b',
})

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

	const mediaMatch = /^\/admin\/media\/(.+)$/.exec(path)
	if (mediaMatch?.[1]) {
		return renderAdminPage({
			title: 'Media Detail',
			body: await renderMediaDetail(decodeURIComponent(mediaMatch[1])),
		})
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

async function handleAdminPost(request: Request) {
	const formData = await request.formData()
	const action = getRequiredString(formData, '_action')

	switch (action) {
		case 'create-directory-feed':
			return createDirectoryFeedFromForm(formData)
		case 'create-curated-feed':
			return createCuratedFeedFromForm(formData)
		case 'update-feed':
			return updateFeedFromForm(formData)
		case 'delete-feed':
			return deleteFeedFromForm(formData)
		case 'create-token':
			return createTokenFromForm(formData)
		case 'add-item':
			return addItemFromForm(formData)
		case 'remove-item':
			return removeItemFromForm(formData)
		case 'clear-items':
			return clearItemsFromForm(formData)
		default:
			return renderAdminPage({
				title: 'Unsupported action',
				body: (
					<section mix={cardStyle}>
						<h2>Unsupported action</h2>
						<p>Unknown admin form action: {action}</p>
						<a href="/admin" mix={buttonStyle}>
							Back to admin
						</a>
					</section>
				),
				status: 400,
			})
	}
}

function renderAdminPage({ title, body, status = 200 }: AdminPageOptions) {
	return renderUi(
		<ServerDocument title={title} entryScript={false}>
			<div mix={pageStyle}>
				<header mix={headerStyle}>
					<a
						href="/admin"
						mix={rmxCss({
							display: 'flex',
							alignItems: 'center',
							gap: '0.75rem',
							color: '#0f172a',
							textDecoration: 'none',
							fontWeight: '700',
						})}
					>
						<img src="/assets/logo.svg" alt="MediaRSS" width="36" height="36" />
						<span>MediaRSS Admin</span>
					</a>
					<nav mix={navStyle} aria-label="Admin navigation">
						<a href="/admin" mix={secondaryButtonStyle}>
							Feeds
						</a>
						<a href="/admin/media" mix={secondaryButtonStyle}>
							Media
						</a>
						<a href="/admin/version" mix={secondaryButtonStyle}>
							Version
						</a>
					</nav>
				</header>
				<main mix={mainStyle}>{body}</main>
			</div>
		</ServerDocument>,
		{ status },
	)
}

async function renderFeedIndex() {
	const feeds = await getFeedSummaries()

	return (
		<div mix={stackStyle}>
			<div mix={rowStyle}>
				<h1 mix={rmxCss({ margin: 0 })}>Your Feeds</h1>
				<a href="/admin/feeds/new" mix={buttonStyle}>
					New Feed
				</a>
			</div>
			{feeds.length === 0 ? (
				<section mix={cardStyle}>
					<h2>No feeds yet</h2>
					<p mix={mutedStyle}>
						Create a directory or curated feed to start publishing media.
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
							<p mix={mutedStyle}>Updated {formatUnixDate(feed.updatedAt)}</p>
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

	const items = isDirectoryFeed(feed) ? [] : await getItemsForFeed(feed.id)
	const media = await scanAllMediaRoots()

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
						<input
							type="hidden"
							name="feedKind"
							value={isDirectoryFeed(feed) ? 'directory' : 'curated'}
						/>
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
							<input
								type="hidden"
								name="feedKind"
								value={isDirectoryFeed(feed) ? 'directory' : 'curated'}
							/>
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
				{isDirectoryFeed(feed)
					? renderDirectoryFeedDetails(feed)
					: renderCuratedItems(feed, items, media)}
				<form method="post" action={`/admin/feeds/${feed.id}`} mix={cardStyle}>
					<input type="hidden" name="_action" value="delete-feed" />
					<input type="hidden" name="feedId" value={feed.id} />
					<input
						type="hidden"
						name="feedKind"
						value={isDirectoryFeed(feed) ? 'directory' : 'curated'}
					/>
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

	if (!file) {
		return (
			<section mix={cardStyle}>
				<h1>Media not found</h1>
				<p>{mediaPath}</p>
				<a href="/admin/media" mix={buttonStyle}>
					Back to media
				</a>
			</section>
		)
	}

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

async function createDirectoryFeedFromForm(formData: FormData) {
	const feedData = getFormFeedData(formData, 'filename')
	const directoryPaths = getLineValues(formData, 'directoryPaths')
	if (directoryPaths.length === 0) {
		return invalidForm('Directory paths are required.', '/admin/feeds/new')
	}
	const feed = await createDirectoryFeed({ ...feedData, directoryPaths })
	await createDirectoryFeedToken({ feedId: feed.id, label: 'Default' })
	return redirect(`/admin/feeds/${feed.id}`, 303)
}

async function createCuratedFeedFromForm(formData: FormData) {
	const feedData = getFormFeedData(formData, 'position')
	const feed = await createCuratedFeed(feedData)
	await createCuratedFeedToken({ feedId: feed.id, label: 'Default' })
	for (const mediaPath of getAllStringValues(formData, 'items')) {
		const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
		await addItemToFeed(feed.id, mediaRoot, relativePath)
	}
	return redirect(`/admin/feeds/${feed.id}`, 303)
}

async function updateFeedFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feedKind = getRequiredString(formData, 'feedKind')
	const feedData = getFormFeedData(formData, 'filename')

	if (feedKind === 'directory') {
		await updateDirectoryFeed(feedId, {
			...feedData,
			directoryPaths: getLineValues(formData, 'directoryPaths'),
		})
	} else {
		await updateCuratedFeed(feedId, feedData)
	}

	return redirect(`/admin/feeds/${feedId}`, 303)
}

async function deleteFeedFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feedKind = getRequiredString(formData, 'feedKind')

	if (feedKind === 'directory') {
		await deleteDirectoryFeed(feedId)
	} else {
		await deleteCuratedFeed(feedId)
	}

	return redirect('/admin', 303)
}

async function createTokenFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const feedKind = getRequiredString(formData, 'feedKind')
	const label = getOptionalString(formData, 'label') ?? 'Manual token'

	if (feedKind === 'directory') {
		await createDirectoryFeedToken({ feedId, label })
	} else {
		await createCuratedFeedToken({ feedId, label })
	}

	return redirect(`/admin/feeds/${feedId}`, 303)
}

async function addItemFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const mediaPath = getRequiredString(formData, 'mediaPath')
	const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
	await addItemToFeed(feedId, mediaRoot, relativePath)
	return redirect(`/admin/feeds/${feedId}`, 303)
}

async function removeItemFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	const mediaPath = getRequiredString(formData, 'mediaPath')
	const { mediaRoot, relativePath } = parseMediaPath(mediaPath)
	await removeItemFromFeed(feedId, mediaRoot, relativePath)
	return redirect(`/admin/feeds/${feedId}`, 303)
}

async function clearItemsFromForm(formData: FormData) {
	const feedId = getRequiredString(formData, 'feedId')
	await clearFeedItems(feedId)
	return redirect(`/admin/feeds/${feedId}`, 303)
}

function invalidForm(message: string, href: string) {
	return renderAdminPage({
		title: 'Invalid form',
		body: (
			<section mix={cardStyle}>
				<h1>Invalid form</h1>
				<p>{message}</p>
				<a href={href} mix={buttonStyle}>
					Back
				</a>
			</section>
		),
		status: 400,
	})
}

function getFormFeedData(
	formData: FormData,
	defaultSortFields: string,
): FormFeedData {
	return {
		name: getRequiredString(formData, 'name').trim(),
		description: getOptionalString(formData, 'description') ?? '',
		subtitle: getOptionalString(formData, 'subtitle'),
		sortFields: getOptionalString(formData, 'sortFields') ?? defaultSortFields,
		sortOrder: getSortOrder(formData),
		feedType: getFeedType(formData),
		link: getOptionalString(formData, 'link'),
		copyright: getOptionalString(formData, 'copyright'),
	}
}

function getSortOrder(formData: FormData): 'asc' | 'desc' {
	const value = getOptionalString(formData, 'sortOrder')
	return value === 'desc' ? 'desc' : 'asc'
}

function getFeedType(formData: FormData): FeedType {
	const value = getOptionalString(formData, 'feedType')
	return value === 'serial' ? 'serial' : 'episodic'
}

function getLineValues(formData: FormData, name: string) {
	return (getOptionalString(formData, name) ?? '')
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter(Boolean)
}

function getAllStringValues(formData: FormData, name: string) {
	return formData
		.getAll(name)
		.filter(
			(value): value is string => typeof value === 'string' && value !== '',
		)
}

function getRequiredString(formData: FormData, name: string) {
	const value = formData.get(name)
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`Missing required form field "${name}"`)
	}
	return value
}

function getOptionalString(formData: FormData, name: string) {
	const value = formData.get(name)
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed || null
}

function normalizePath(pathname: string) {
	return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function formatUnixDate(value: number) {
	return new Date(value * 1000).toLocaleString()
}
