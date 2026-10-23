import { execFile, spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { chromium } from '@playwright/test'
import semver from 'semver'
import { createControlContext } from './control-context.ts'
import {
	checkFeatureMap,
	findFeature,
	getFeatureEntries,
	writeFeatureMap,
} from './feature-map.ts'

const execFileAsync = promisify(execFile)

const repoRoot = path.join(import.meta.dirname, '..')
const controlRoot = path.join(repoRoot, 'data', 'control')
const fixturesDir = path.join(repoRoot, 'test', 'fixtures')
const mediaRoots = ['audio', 'video'] as const
const defaultPort = 22051
const defaultImage = 'kentcdodds/mediarss'

const commands = [
	'doctor',
	'dev',
	'stop',
	'request',
	'execute',
	'browse',
	'map',
	'health',
	'help',
] as const
type Command = (typeof commands)[number]

type DevState = { pid: number; port: number; origin: string; startedAt: string }

type HealthBody = {
	status?: string
	commit?: { sha?: string } | null
	database?: { ok?: boolean; error?: string }
	mediaRoots?: Array<string>
}

const usage = `control-mediarss: drive a local MediaRSS for verification.

Run as: npm run --silent control -- <command> [options]

  doctor                                   Check runtime, deps, hooks, browsers, ffmpeg, control server
  dev [--fresh] [--foreground] [--port N]  Start (or reuse) the control server on fixture media
  stop                                     Stop the background control server
  request METHOD /path [--contains T]... [--not-contains T]... [--status N]
          [--json-body JSON] [--body TEXT] [--header "k: v"]... [--dump FILE]
  execute --code-file FILE [--params JSON] Run a fixture's default export with a ControlContext
  browse --path /admin [--wait-for T]... [--record] [--out DIR] [--headed]
  map [QUERY] | map --check | map --write  Feature Map from app/routes.ts + tools/feature-notes.ts
  health [--sha SHA] [--wait SECONDS]      Running server's /health (and expected commit)
  health --published --sha SHA [--wait SECONDS] [--image NAME]
                                           Docker Hub has the image built from SHA

Every command accepts --origin URL (default: the control server) and --json.
Admin routes have no app-level auth (Cloudflare Access guards them in
production), so there is no login step.`

class ControlError extends Error {}

function fail(message: string): never {
	throw new ControlError(message)
}

function isCommand(value: string | undefined): value is Command {
	return commands.includes(value as Command)
}

function print(json: boolean, value: unknown, text: string) {
	console.log(json ? JSON.stringify(value, null, 2) : text)
}

/** Each port gets its own databases and media copy, so servers never share state. */
function controlPaths(port: number) {
	const dir = path.join(controlRoot, String(port))
	return {
		dir,
		state: path.join(dir, 'dev.json'),
		log: path.join(dir, 'dev.log'),
		media: path.join(dir, 'media'),
	}
}

async function readState(port: number): Promise<DevState | null> {
	try {
		return JSON.parse(
			await readFile(controlPaths(port).state, 'utf8'),
		) as DevState
	} catch {
		return null
	}
}

function resolveOrigin(flag: string | undefined) {
	if (flag) return flag.replace(/\/$/, '')
	if (process.env.CONTROL_ORIGIN) return process.env.CONTROL_ORIGIN
	return `http://127.0.0.1:${defaultPort}`
}

async function fetchHealth(
	origin: string,
): Promise<{ reachable: boolean; body: HealthBody | null }> {
	try {
		const response = await fetch(`${origin}/health`, {
			signal: AbortSignal.timeout(3000),
		})
		const body = (await response.json().catch(() => null)) as HealthBody | null
		return { reachable: true, body }
	} catch {
		return { reachable: false, body: null }
	}
}

function isHealthy(body: HealthBody | null) {
	return body?.status === 'ok' && body.database?.ok === true
}

function isPidAlive(pid: number) {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

async function waitFor<T>(
	check: () => Promise<T | null>,
	timeoutMs: number,
	intervalMs = 500,
): Promise<T | null> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const result = await check()
		if (result) return result
		if (Date.now() + intervalMs > deadline) return null
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}
}

async function prepareControlDir(port: number) {
	const { media } = controlPaths(port)
	for (const root of mediaRoots) {
		const target = path.join(media, root)
		if (!existsSync(target)) {
			await mkdir(media, { recursive: true })
			await cp(path.join(fixturesDir, root), target, { recursive: true })
		}
	}
}

function controlEnv(port: number): NodeJS.ProcessEnv {
	const { dir, media } = controlPaths(port)
	return {
		...process.env,
		NODE_ENV: 'development',
		PORT: String(port),
		DATABASE_PATH: path.join(dir, 'sqlite.db'),
		CACHE_DATABASE_PATH: path.join(dir, 'cache.db'),
		MEDIA_PATHS: mediaRoots
			.map((root) => `${root}:${path.join(media, root)}`)
			.join(','),
	}
}

async function stopServer(port: number): Promise<boolean> {
	const state = await readState(port)
	if (!state) return false
	if (isPidAlive(state.pid)) {
		try {
			// The server is spawned detached, so it leads its own process group.
			process.kill(-state.pid, 'SIGTERM')
		} catch {
			process.kill(state.pid, 'SIGTERM')
		}
		await waitFor(
			async () => (isPidAlive(state.pid) ? null : true),
			10_000,
			200,
		)
	}
	await rm(controlPaths(port).state, { force: true })
	return true
}

async function tailLog(port: number, lines = 40) {
	const log = await readFile(controlPaths(port).log, 'utf8').catch(() => '')
	return log.split('\n').slice(-lines).join('\n')
}

async function dev(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			fresh: { type: 'boolean', default: false },
			foreground: { type: 'boolean', default: false },
			port: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const port = values.port ? Number(values.port) : defaultPort
	const origin = `http://127.0.0.1:${port}`
	const paths = controlPaths(port)

	if (values.fresh) {
		await stopServer(port)
		await rm(paths.dir, { recursive: true, force: true })
	}

	const existing = await fetchHealth(origin)
	if (existing.reachable) {
		if (!isHealthy(existing.body)) {
			fail(
				`Something is already listening on ${origin} and it is not a healthy MediaRSS. Stop it or pass --port.`,
			)
		}
		if (values.foreground || values.fresh) {
			fail(
				`A server not started by this CLI is running on ${origin}; stop it or pass --port.`,
			)
		}
		print(
			values.json,
			{ origin, reused: true },
			`Reusing the control server at ${origin}`,
		)
		return
	}

	await prepareControlDir(port)
	const env = controlEnv(port)

	if (values.foreground) {
		const child = spawn(process.execPath, ['server/dev.ts'], {
			cwd: repoRoot,
			env,
			stdio: 'inherit',
		})
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			process.on(signal, () => child.kill(signal))
		}
		const code = await new Promise<number>((resolve) =>
			child.on('exit', (exitCode) => resolve(exitCode ?? 0)),
		)
		process.exit(code)
	}

	const log = openSync(paths.log, 'w')
	const child = spawn(process.execPath, ['server/dev.ts'], {
		cwd: repoRoot,
		env,
		detached: true,
		stdio: ['ignore', log, log],
	})
	child.unref()
	if (!child.pid) fail('Failed to spawn the control server')
	const state: DevState = {
		pid: child.pid,
		port,
		origin,
		startedAt: new Date().toISOString(),
	}
	await writeFile(paths.state, JSON.stringify(state, null, 2))

	const healthy = await waitFor(async () => {
		const { body } = await fetchHealth(origin)
		return isHealthy(body) ? body : null
	}, 90_000)
	if (!healthy) {
		const lastLines = await tailLog(port)
		await stopServer(port)
		fail(
			`The control server did not become healthy on ${origin}. Last log lines:\n${lastLines}`,
		)
	}
	print(
		values.json,
		{ origin, reused: false, pid: child.pid, log: paths.log },
		`Control server running at ${origin} (pid ${child.pid}, log ${path.relative(process.cwd(), paths.log)})`,
	)
}

async function stop(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			port: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const port = values.port ? Number(values.port) : defaultPort
	const stopped = await stopServer(port)
	print(
		values.json,
		{ stopped, port },
		stopped
			? `Stopped the control server on port ${port}`
			: `No control server started by this CLI on port ${port}`,
	)
}

function isTextContentType(contentType: string) {
	return /json|text|xml|html|javascript|svg/.test(contentType)
}

async function request(args: Array<string>) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			contains: { type: 'string', multiple: true, default: [] },
			'not-contains': { type: 'string', multiple: true, default: [] },
			status: { type: 'string' },
			json: { type: 'boolean', default: false },
			body: { type: 'string' },
			'json-body': { type: 'string' },
			header: { type: 'string', multiple: true, default: [] },
			dump: { type: 'string' },
			origin: { type: 'string' },
		},
	})
	const [methodArg, pathname] = positionals
	if (!methodArg || !pathname) fail('Usage: request METHOD /path [options]')
	const method = methodArg.toUpperCase()
	const origin = resolveOrigin(values.origin)

	const headers: Record<string, string> = {}
	for (const header of values.header) {
		const index = header.indexOf(':')
		if (index === -1) fail(`Invalid --header "${header}"; use "name: value"`)
		headers[header.slice(0, index).trim()] = header.slice(index + 1).trim()
	}
	const context = createControlContext(origin)
	const response = await context.request(method, pathname, {
		headers,
		...(values['json-body'] !== undefined
			? { json: JSON.parse(values['json-body']) }
			: {}),
		...(values.body !== undefined ? { body: values.body } : {}),
	})

	const contentType = response.headers.get('content-type') ?? ''
	const bytes = new Uint8Array(await response.arrayBuffer())
	const text = isTextContentType(contentType)
		? new TextDecoder().decode(bytes)
		: ''
	if (values.dump) await writeFile(values.dump, bytes)

	const problems: Array<string> = []
	if (values.status && response.status !== Number(values.status)) {
		problems.push(`expected status ${values.status}, got ${response.status}`)
	}
	for (const needle of values.contains) {
		if (!text.includes(needle))
			problems.push(`body does not contain "${needle}"`)
	}
	for (const needle of values['not-contains']) {
		if (text.includes(needle)) problems.push(`body contains "${needle}"`)
	}

	const url = new URL(pathname, origin).toString()
	const summary = `${response.status} ${method} ${url} (${contentType || 'no content-type'}, ${bytes.length} bytes)`
	const location = response.headers.get('location')
	const preview = text
		? text.length > 4000
			? `${text.slice(0, 4000)}\n… (${text.length - 4000} more characters; use --dump)`
			: text
		: ''
	print(
		values.json,
		{
			ok: problems.length === 0,
			status: response.status,
			url,
			contentType,
			bytes: bytes.length,
			location,
			problems,
			dumped: values.dump ?? null,
			body: text.slice(0, 4000),
		},
		[
			summary,
			location ? `location: ${location}` : '',
			values.dump ? '' : preview,
		]
			.filter(Boolean)
			.join('\n'),
	)
	if (problems.length > 0) fail(problems.join('\n'))
}

async function execute(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			'code-file': { type: 'string' },
			params: { type: 'string' },
			origin: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const file = values['code-file']
	if (!file) fail('Usage: execute --code-file FILE [--params JSON]')
	const origin = resolveOrigin(values.origin)
	const params = values.params ? JSON.parse(values.params) : {}
	const fixture = (await import(pathToFileURL(path.resolve(file)).href)) as {
		default?: (context: ReturnType<typeof createControlContext>) => unknown
	}
	if (typeof fixture.default !== 'function') {
		fail(`${file} must default-export a function`)
	}
	const result = await fixture.default(createControlContext(origin, params))
	print(values.json, { ok: true, result }, JSON.stringify(result, null, 2))
}

async function browse(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			path: { type: 'string', default: '/admin' },
			'wait-for': { type: 'string', multiple: true, default: [] },
			record: { type: 'boolean', default: false },
			headed: { type: 'boolean', default: false },
			out: { type: 'string' },
			origin: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const origin = resolveOrigin(values.origin)
	const outDir =
		values.out ??
		path.join(
			controlRoot,
			'browse',
			new Date().toISOString().replaceAll(/[:.]/g, '-'),
		)
	await mkdir(outDir, { recursive: true })
	const url = new URL(values.path, origin).toString()

	const browser = await chromium.launch({
		channel: 'chromium',
		headless: !values.headed,
	})
	const context = await browser.newContext(
		values.record ? { recordVideo: { dir: outDir } } : {},
	)
	const page = await context.newPage()
	const pageErrors: Array<string> = []
	const consoleErrors: Array<string> = []
	page.on('pageerror', (error) => pageErrors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text())
	})

	const problems: Array<string> = []
	let status: number | null = null
	try {
		const response = await page.goto(url, { waitUntil: 'networkidle' })
		status = response?.status() ?? null
		for (const text of values['wait-for']) {
			try {
				await page
					.getByText(text)
					.first()
					.waitFor({ state: 'visible', timeout: 10_000 })
			} catch {
				problems.push(`"${text}" never became visible`)
			}
		}
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error))
	}
	const screenshot = path.join(outDir, 'screenshot.png')
	await page.screenshot({ path: screenshot, fullPage: true })
	const video = page.video()
	await context.close()
	await browser.close()
	const videoPath = video ? await video.path() : null

	problems.push(...pageErrors.map((message) => `page error: ${message}`))
	print(
		values.json,
		{
			ok: problems.length === 0,
			url,
			status,
			finalUrl: page.url(),
			screenshot,
			video: videoPath,
			consoleErrors,
			problems,
		},
		[
			`${status ?? 'no response'} ${url}`,
			`screenshot: ${screenshot}`,
			videoPath ? `video: ${videoPath}` : '',
			consoleErrors.length
				? `console errors:\n  ${consoleErrors.join('\n  ')}`
				: '',
		]
			.filter(Boolean)
			.join('\n'),
	)
	if (problems.length > 0) fail(problems.join('\n'))
}

async function map(args: Array<string>) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			check: { type: 'boolean', default: false },
			write: { type: 'boolean', default: false },
			json: { type: 'boolean', default: false },
		},
	})
	if (values.write) {
		await writeFeatureMap()
		print(values.json, { written: true }, 'Wrote the Feature Map')
		return
	}
	if (values.check) {
		const problems = await checkFeatureMap()
		print(
			values.json,
			{ ok: problems.length === 0, problems },
			problems.length ? problems.join('\n') : 'Feature Map is current',
		)
		if (problems.length > 0) fail('Feature Map check failed')
		return
	}
	const [query] = positionals
	const entries = query ? findFeature(query) : getFeatureEntries()
	if (query && entries.length === 0) fail(`No route matches "${query}"`)
	print(
		values.json,
		entries,
		entries
			.map((entry) =>
				query
					? [
							`${entry.name}  ${entry.method === 'ANY' ? (entry.methods ?? 'ANY') : entry.method} ${entry.pattern}${entry.high ? '  (high: needs Kent)' : ''}`,
							`  what:  ${entry.summary}`,
							entry.seed ? `  seed:  ${entry.seed}` : '',
							`  reach: ${entry.reach}`,
						]
							.filter(Boolean)
							.join('\n')
					: `${entry.name.padEnd(28)} ${entry.pattern}`,
			)
			.join(query ? '\n\n' : '\n'),
	)
}

async function resolveFullSha(sha: string) {
	if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase()
	try {
		const { stdout } = await execFileAsync(
			'git',
			['rev-parse', '--verify', `${sha}^{commit}`],
			{ cwd: repoRoot },
		)
		return stdout.trim()
	} catch {
		fail(
			`Cannot resolve "${sha}" to a full commit SHA; fetch first or pass all 40 characters`,
		)
	}
}

async function health(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			sha: { type: 'string' },
			wait: { type: 'string', default: '0' },
			published: { type: 'boolean', default: false },
			image: { type: 'string', default: defaultImage },
			origin: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const waitMs = Number(values.wait) * 1000

	if (values.published) {
		if (!values.sha) fail('health --published needs --sha')
		const sha = await resolveFullSha(values.sha)
		const [namespace, repository] = values.image.split('/')
		const tag = `sha-${sha}`
		const tagUrl = `https://hub.docker.com/v2/namespaces/${namespace}/repositories/${repository}/tags/${tag}`
		const result = await waitFor(
			async () => {
				const response = await fetch(tagUrl).catch(() => null)
				if (!response?.ok) return null
				return (await response.json()) as { last_updated?: string }
			},
			waitMs,
			15_000,
		)
		print(
			values.json,
			{ ok: Boolean(result), image: `${values.image}:${tag}`, ...result },
			result
				? `Published: ${values.image}:${tag} (updated ${result.last_updated})`
				: `Not published: ${values.image}:${tag}`,
		)
		if (!result) fail(`Docker Hub has no ${values.image}:${tag}`)
		return
	}

	const origin = resolveOrigin(values.origin)
	const expected = values.sha?.toLowerCase()
	const matches = (body: HealthBody | null) => {
		if (!isHealthy(body)) return false
		if (!expected) return true
		const actual = body?.commit?.sha?.toLowerCase() ?? ''
		return (
			actual.length >= 7 &&
			(actual.startsWith(expected) || expected.startsWith(actual))
		)
	}
	const body =
		(await waitFor(
			async () => {
				const { body } = await fetchHealth(origin)
				return matches(body) ? body : null
			},
			waitMs,
			5000,
		)) ?? (await fetchHealth(origin)).body
	const ok = matches(body)
	print(
		values.json,
		{ ok, origin, expectedSha: expected ?? null, health: body },
		body
			? `${ok ? 'OK' : 'MISMATCH'} ${origin}: status ${body.status}, commit ${body.commit?.sha ?? 'unknown'}, database ${body.database?.ok ? 'ok' : (body.database?.error ?? 'unknown')}`
			: `Unreachable: ${origin}/health`,
	)
	if (!ok) {
		fail(
			expected
				? `${origin} is not healthy at commit ${expected}`
				: `${origin} is not healthy`,
		)
	}
}

type DoctorCheck = {
	name: string
	ok: boolean
	level: 'error' | 'warn' | 'info'
	detail: string
	fix?: string
}

async function doctor(args: Array<string>) {
	const { values } = parseArgs({
		args,
		options: {
			origin: { type: 'string' },
			json: { type: 'boolean', default: false },
		},
	})
	const checks: Array<DoctorCheck> = []
	const packageJson = JSON.parse(
		await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
	) as { engines: { node: string } }

	checks.push({
		name: 'node',
		ok: semver.satisfies(process.version, packageJson.engines.node),
		level: 'error',
		detail: `${process.version} (needs ${packageJson.engines.node})`,
		fix: `Install Node ${packageJson.engines.node}`,
	})

	checks.push({
		name: 'dependencies',
		ok: existsSync(
			path.join(repoRoot, 'node_modules', 'remix', 'package.json'),
		),
		level: 'error',
		detail: 'node_modules/remix',
		fix: 'npm install',
	})

	const hooksPath = await execFileAsync('git', ['config', 'core.hooksPath'], {
		cwd: repoRoot,
	})
		.then(({ stdout }) => stdout.trim())
		.catch(() => '')
	checks.push({
		name: 'git hooks',
		ok: hooksPath === '.githooks',
		level: 'warn',
		detail: hooksPath ? `core.hooksPath=${hooksPath}` : 'core.hooksPath unset',
		fix: 'npm run prepare',
	})

	const launchError = await chromium
		.launch({ channel: 'chromium' })
		.then((browser) => browser.close())
		.then(() => null)
		.catch((error: Error) => error.message.split('\n')[0] ?? 'launch failed')
	checks.push({
		name: 'playwright chromium',
		ok: launchError === null,
		level: 'warn',
		detail: launchError ?? 'headless launch works (browse, Playwright)',
		fix: 'npx playwright install --no-shell chromium',
	})

	const ffmpeg = await execFileAsync('ffmpeg', ['-version'])
		.then(({ stdout }) => stdout.split('\n')[0] ?? 'ffmpeg')
		.catch(() => null)
	checks.push({
		name: 'ffmpeg',
		ok: Boolean(ffmpeg),
		level: 'warn',
		detail: ffmpeg ?? 'not on PATH (media metadata edits need it)',
		fix: 'brew install ffmpeg (macOS) or apt-get install ffmpeg',
	})

	const missingFixtures = mediaRoots.filter(
		(root) => !existsSync(path.join(fixturesDir, root)),
	)
	checks.push({
		name: 'fixture media',
		ok: missingFixtures.length === 0,
		level: 'error',
		detail: missingFixtures.length
			? `missing test/fixtures/${missingFixtures.join(', ')}`
			: 'test/fixtures/audio, test/fixtures/video',
		fix: 'git checkout -- test/fixtures',
	})

	const origin = resolveOrigin(values.origin)
	const { reachable, body } = await fetchHealth(origin)
	checks.push({
		name: 'control server',
		ok: isHealthy(body),
		level: 'info',
		detail: reachable
			? `${origin}: status ${body?.status ?? 'unknown'}, database ${body?.database?.ok ? 'ok' : (body?.database?.error ?? 'unknown')}`
			: `${origin} not running`,
		fix: 'npm run --silent control -- dev',
	})

	const failed = checks.filter((check) => !check.ok && check.level === 'error')
	print(
		values.json,
		{ ok: failed.length === 0, checks },
		checks
			.map((check) => {
				const mark = check.ok
					? 'ok  '
					: check.level === 'info'
						? 'info'
						: check.level
				return `${mark.padEnd(5)} ${check.name}: ${check.detail}${check.ok || !check.fix ? '' : `\n      fix: ${check.fix}`}`
			})
			.join('\n'),
	)
	if (failed.length > 0) fail(`${failed.length} doctor check(s) failed`)
}

async function main() {
	const [command, ...args] = process.argv.slice(2)
	if (!isCommand(command)) {
		console.log(usage)
		if (command && command !== '--help' && command !== '-h') {
			fail(`Unknown command "${command}"`)
		}
		return
	}
	switch (command) {
		case 'doctor':
			return doctor(args)
		case 'dev':
			return dev(args)
		case 'stop':
			return stop(args)
		case 'request':
			return request(args)
		case 'execute':
			return execute(args)
		case 'browse':
			return browse(args)
		case 'map':
			return map(args)
		case 'health':
			return health(args)
		case 'help':
			console.log(usage)
			return
		default: {
			const unhandled: never = command
			fail(`Unhandled command ${String(unhandled)}`)
		}
	}
}

try {
	await main()
} catch (error) {
	if (error instanceof ControlError) {
		console.error(error.message)
		process.exit(1)
	}
	throw error
}
