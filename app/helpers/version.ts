import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Application start time - captured when this module is first loaded.
 */
const APP_START_TIME = Date.now()

/**
 * Commit identity reported by health and version.
 *
 * `source` is `'env'` when `COMMIT_SHA` or `SOURCE_COMMIT` is set (message
 * `'baked at image build'`, `date` is process start), otherwise `'git'`.
 */
export type CommitInfo = {
	hash: string
	shortHash: string
	message: string
	date: string
	source: 'env' | 'git'
}

function readBakedCommitSha(): string | null {
	const sha = process.env.COMMIT_SHA || process.env.SOURCE_COMMIT
	if (!sha) return null
	const trimmed = sha.trim()
	return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed : null
}

function commitFromSha(
	sha: string,
	source: CommitInfo['source'],
	rest?: Partial<Pick<CommitInfo, 'message' | 'date'>>,
): CommitInfo {
	return {
		hash: sha,
		shortHash: sha.slice(0, 7),
		message: rest?.message ?? 'baked at image build',
		date: rest?.date ?? new Date(APP_START_TIME).toISOString(),
		source,
	}
}

/**
 * Snapshot returned by `getVersionInfo()` for `/health` and `/admin/api/version`.
 */
export type VersionInfo = {
	version: string | null
	commit: CommitInfo | null
	startTime: string
	uptimeMs: number
}

/**
 * Get the project root directory.
 * Goes up from app/helpers to find package.json.
 */
function getProjectRoot(): string {
	// From app/helpers/version.ts, go up two levels to project root
	return path.resolve(import.meta.dirname, '../..')
}

/**
 * Get the application version from package.json.
 * Returns null if package.json cannot be read.
 */
export async function getAppVersion(): Promise<string | null> {
	try {
		const packageJsonPath = path.join(getProjectRoot(), 'package.json')
		const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
			version?: string
		}
		return packageJson.version ?? null
	} catch {
		return null
	}
}

/**
 * Resolve the running commit.
 *
 * Prefers baked `COMMIT_SHA` or `SOURCE_COMMIT` (`source: 'env'`). Falls
 * back to `git log` (`source: 'git'`). Returns null if neither source is
 * available.
 */
export async function getCommitInfo(): Promise<CommitInfo | null> {
	const baked = readBakedCommitSha()
	if (baked) return commitFromSha(baked, 'env')
	try {
		const [{ stdout: hash }, { stdout: message }, { stdout: date }] =
			await Promise.all([
				execFileAsync('git', ['rev-parse', 'HEAD'], {
					cwd: getProjectRoot(),
				}),
				execFileAsync('git', ['log', '-1', '--pretty=%B'], {
					cwd: getProjectRoot(),
				}),
				execFileAsync('git', ['log', '-1', '--format=%cI'], {
					cwd: getProjectRoot(),
				}),
			])

		const gitHash = hash.trim()
		return {
			hash: gitHash,
			shortHash: gitHash.slice(0, 7),
			message: message.trim(),
			date: date.trim(),
			source: 'git',
		}
	} catch {
		return null
	}
}

/**
 * App version, commit, start time, and uptime for `/health` and
 * `/admin/api/version`.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
	const [version, commit] = await Promise.all([
		getAppVersion(),
		getCommitInfo(),
	])

	return {
		version,
		commit,
		startTime: new Date(APP_START_TIME).toISOString(),
		uptimeMs: Date.now() - APP_START_TIME,
	}
}
