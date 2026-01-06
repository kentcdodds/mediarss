import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

type Viewport = { name: string; width: number; height: number }

function ensureDir(dirPath: string) {
	fs.mkdirSync(dirPath, { recursive: true })
}

function assertOk(res: Response, label: string) {
	if (!res.ok) {
		throw new Error(`${label} failed: HTTP ${res.status}`)
	}
}

async function json<T>(res: Response, label: string): Promise<T> {
	assertOk(res, label)
	return (await res.json()) as T
}

function buildMediaPaths(rootDir: string) {
	const audioPath = path.resolve(rootDir, 'test', 'fixtures', 'audio')
	const videoPath = path.resolve(rootDir, 'test', 'fixtures', 'video')

	return {
		audioPath,
		videoPath,
		mediaPaths: `audio:${audioPath},video:${videoPath}`,
	}
}

async function seedData(baseUrl: string) {
	type MediaListResponse = {
		items: Array<{ rootName: string; relativePath: string; title: string }>
	}

	const media = await json<MediaListResponse>(
		await fetch(`${baseUrl}/admin/api/media`),
		'GET /admin/api/media',
	)

	if (media.items.length === 0) {
		throw new Error(
			'No media files found. Check MEDIA_PATHS is pointing at fixtures.',
		)
	}

	const items = media.items.slice(0, 2).map((item) => ({
		mediaPath: item.relativePath
			? `${item.rootName}:${item.relativePath}`
			: item.rootName,
	}))

	type CreateFeedResponse = { id: string }

	// Create a curated feed with a couple of items (nice for screenshots).
	const curatedFeed = await json<CreateFeedResponse>(
		await fetch(`${baseUrl}/admin/api/feeds/curated`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'Sample Curated Feed',
				description: 'Created automatically for screenshots.',
				sortFields: 'position',
				sortOrder: 'asc',
				items: items.map((i) => i.mediaPath),
			}),
		}),
		'POST /admin/api/feeds/curated',
	)

	// Create a directory feed pointing at the root directories.
	await json<CreateFeedResponse>(
		await fetch(`${baseUrl}/admin/api/feeds/directory`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'Sample Directory Feed',
				description: 'Created automatically for screenshots.',
				directoryPaths: ['audio', 'video'],
				sortFields: 'publicationDate',
				sortOrder: 'desc',
			}),
		}),
		'POST /admin/api/feeds/directory',
	)

	const firstMedia = media.items[0]
	if (!firstMedia) throw new Error('Expected at least one media file')

	const mediaDetailPath = firstMedia.relativePath
		? `${encodeURIComponent(firstMedia.rootName)}/${encodeURIComponent(firstMedia.relativePath)}`
		: encodeURIComponent(firstMedia.rootName)

	return { curatedFeedId: curatedFeed.id, mediaDetailPath }
}

function runChromeScreenshot({
	url,
	outputPath,
	viewport,
}: {
	url: string
	outputPath: string
	viewport: Viewport
}) {
	const userDataDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'mediarss-chrome-profile-'),
	)

	const args = [
		'--headless=new',
		'--no-sandbox',
		'--disable-gpu',
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-scrollbars',
		'--disable-dev-shm-usage',
		'--disable-features=Vulkan',
		`--user-data-dir=${userDataDir}`,
		`--window-size=${viewport.width},${viewport.height}`,
		'--force-device-scale-factor=2',
		'--virtual-time-budget=5000',
		`--screenshot=${outputPath}`,
		url,
	]

	const proc = Bun.spawn(['google-chrome', ...args], {
		stdout: 'ignore',
		stderr: 'pipe',
	})

	const deadlineMs = 45_000

	const waitForScreenshot = async () => {
		const start = Date.now()
		while (Date.now() - start < deadlineMs) {
			try {
				const stat = fs.statSync(outputPath)
				if (stat.size > 0) {
					// Make sure the file size is stable.
					const size1 = stat.size
					await Bun.sleep(300)
					const size2 = fs.statSync(outputPath).size
					if (size2 === size1) return
				}
			} catch {
				// Not written yet.
			}
			await Bun.sleep(200)
		}
	}

	return Promise.race([
		(async () => {
			await waitForScreenshot()
			// We often see Chrome not exit cleanly in CI; once we have the file, terminate.
			proc.kill('SIGTERM')
			await Bun.sleep(300)
			proc.kill('SIGKILL')
			await proc.exited
		})(),
		(async () => {
			const exitCode = await proc.exited
			if (exitCode !== 0) {
				const stderr = await new Response(proc.stderr).text()
				throw new Error(
					`Screenshot failed (${viewport.name}) for ${url}: exit ${exitCode}\n${stderr}`,
				)
			}
		})(),
	])
}

async function main() {
	const rootDir = path.resolve(import.meta.dirname, '..')
	const outDir = path.resolve(rootDir, 'docs', 'screenshots')
	const dataDir = path.resolve(rootDir, 'data')

	ensureDir(outDir)
	ensureDir(dataDir)

	const { mediaPaths } = buildMediaPaths(rootDir)

	// Configure a deterministic, isolated environment for screenshots.
	process.env.NODE_ENV = 'test'
	process.env.DATABASE_PATH = path.resolve(dataDir, 'screenshots.db')
	process.env.CACHE_DATABASE_PATH = path.resolve(
		dataDir,
		'screenshots-cache.db',
	)
	process.env.MEDIA_PATHS = mediaPaths
	process.env.PORT = '0'

	// Initialize env before importing anything that reads it.
	await import('#app/config/init-env.ts')

	const [{ db }, { migrate }, { createBundlingRoutes }] = await Promise.all([
		import('#app/db/index.ts'),
		import('#app/db/migrations.ts'),
		import('../server/bundling.ts'),
	])
	migrate(db)

	const appRouter = (await import('#app/router.tsx')).default

	const server = Bun.serve({
		port: 0,
		idleTimeout: 30,
		routes: createBundlingRoutes(rootDir),
		async fetch(request) {
			const url = new URL(request.url)
			if (url.pathname === '/') {
				return Response.redirect(new URL('/admin', request.url), 302)
			}
			return await appRouter.fetch(request)
		},
	})

	const baseUrl = `http://127.0.0.1:${server.port}`
	const { curatedFeedId, mediaDetailPath } = await seedData(baseUrl)

	const viewports: Viewport[] = [
		{ name: 'desktop', width: 1440, height: 900 },
		{ name: 'mobile', width: 390, height: 844 },
	]

	const pages = [
		{ slug: 'feed-list', path: '/admin' },
		{ slug: 'create-feed', path: '/admin/feeds/new' },
		{ slug: 'feed-detail', path: `/admin/feeds/${curatedFeedId}` },
		{ slug: 'media-list', path: '/admin/media' },
		{ slug: 'media-detail', path: `/admin/media/${mediaDetailPath}` },
	]

	for (const page of pages) {
		for (const viewport of viewports) {
			const fileName = `${page.slug}-${viewport.name}.png`
			const outputPath = path.resolve(outDir, fileName)
			await runChromeScreenshot({
				url: `${baseUrl}${page.path}`,
				outputPath,
				viewport,
			})
		}
	}

	server.stop(true)
}

await main()
