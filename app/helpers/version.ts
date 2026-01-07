import path from 'node:path'

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
		const file = Bun.file(packageJsonPath)
		const packageJson = (await file.json()) as { version?: string }
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
	try {
		// Get full commit hash
		const hashResult = await Bun.$`git rev-parse HEAD`.quiet()
		if (hashResult.exitCode !== 0) return null
		const hash = hashResult.text().trim()

		// Get commit message
		const messageResult = await Bun.$`git log -1 --pretty=%B`.quiet()
		const message = messageResult.text().trim()

		// Get commit date in ISO format
		const dateResult = await Bun.$`git log -1 --format=%cI`.quiet()
		const date = dateResult.text().trim()

		return {
			hash,
			shortHash: hash.slice(0, 7),
			message,
			date,
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
