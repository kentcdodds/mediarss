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
 * Git commit information.
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
 * Full version information returned by getVersionInfo().
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
 * Get git commit information for the current repository.
 * Returns null if not in a git repository or git commands fail.
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
 * Get the shortened commit hash (first 7 characters).
 * Returns null if commit info cannot be retrieved.
 */
export async function getShortCommitHash(): Promise<string | null> {
	const commit = await getCommitInfo()
	return commit?.shortHash ?? null
}

/**
 * Get the display version string.
 * Returns the app version if available, otherwise the short commit hash.
 */
export async function getDisplayVersion(): Promise<string | null> {
	const version = await getAppVersion()
	if (version) return version
	return getShortCommitHash()
}

/**
 * Get full version information including app version, commit info, and uptime.
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
