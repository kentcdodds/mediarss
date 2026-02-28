import nodePath from 'node:path'
import {
	createIssue,
	createSchema,
	defaulted,
	enum_,
	type InferOutput,
	type Issue,
	object,
	parseSafe,
	string,
} from 'remix/data-schema'
import * as coerce from 'remix/data-schema/coerce'

/**
 * Schema for a single media root entry.
 * Format: "name:path" (e.g., "shows:/media/shows")
 */
const MediaRootSchema = createSchema<unknown, MediaRoot>((value, context) => {
	if (typeof value !== 'string') {
		return { issues: [createIssue('Expected string', context.path)] }
	}

	const colonIndex = value.indexOf(':')
	if (colonIndex === -1) {
		return {
			issues: [
				createIssue(
					`Invalid media root format: "${value}". Expected "name:path" (e.g., "shows:/media/shows")`,
					context.path,
				),
			],
		}
	}

	const name = value.slice(0, colonIndex).trim()
	const path = value.slice(colonIndex + 1).trim()
	if (!name || !path) {
		return {
			issues: [
				createIssue(
					`Invalid media root format: "${value}". Both name and path are required.`,
					context.path,
				),
			],
		}
	}

	return { value: { name, path } }
})

/**
 * Schema for MEDIA_PATHS environment variable.
 * Format: "name1:path1,name2:path2,name3:path3"
 * Example: "shows:/media/shows,personal:/media/personal,other:/media/other"
 * Note: Each name must be unique - duplicate names are not allowed.
 */
const MediaPathsSchema = createSchema<unknown, Array<MediaRoot>>(
	(value, context) => {
		if (value === undefined || value === '') {
			return { value: [] }
		}
		if (typeof value !== 'string') {
			return { issues: [createIssue('Expected string', context.path)] }
		}

		const entries = value
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)

		const roots: MediaRoot[] = []
		const issues: Issue[] = []

		for (const [index, entry] of entries.entries()) {
			const parsed = parseSafe(MediaRootSchema, entry)
			if (!parsed.success) {
				for (const issue of parsed.issues) {
					issues.push(
						createIssue(issue.message, [
							...context.path,
							index,
							...(issue.path ?? []),
						]),
					)
				}
				continue
			}
			roots.push(parsed.value)
		}

		const names = roots.map((root) => root.name)
		if (new Set(names).size !== names.length) {
			const duplicates = names.filter(
				(name, index) => names.indexOf(name) !== index,
			)
			issues.push(
				createIssue(
					`Duplicate media path names are not allowed. Found duplicates: ${[...new Set(duplicates)].join(', ')}`,
					context.path,
				),
			)
		}

		if (issues.length > 0) {
			return { issues }
		}

		return { value: roots }
	},
)

/**
 * Helper to parse optional integer env vars with defaults.
 */
function optionalInt(defaultValue: number) {
	return defaulted(
		coerce
			.number()
			.refine((num) => Number.isInteger(num), 'Expected an integer value'),
		defaultValue,
	)
}

/**
 * Environment variable schema for MediaRSS.
 */
const EnvSchema = object({
	NODE_ENV: defaulted(
		enum_(['production', 'development', 'test'] as const),
		'development',
	),
	PORT: optionalInt(22050),
	DATABASE_PATH: defaulted(string(), './data/sqlite.db'),
	CACHE_DATABASE_PATH: defaulted(string(), './data/cache.db'),
	MEDIA_PATHS: MediaPathsSchema,

	// Rate limiting (requests per minute per IP)
	RATE_LIMIT_ADMIN_READ: optionalInt(5000),
	RATE_LIMIT_ADMIN_WRITE: optionalInt(30),
	RATE_LIMIT_MEDIA: optionalInt(300),
	RATE_LIMIT_DEFAULT: optionalInt(1000),

	// Feed analytics retention window in days.
	// Events older than this are pruned on startup.
	ANALYTICS_RETENTION_DAYS: optionalInt(180),

	// GitHub repository URL for linking to commits (optional)
	GITHUB_REPO: defaulted(string(), 'https://github.com/kentcdodds/mediarss'),
})

export type Env = InferOutput<typeof EnvSchema>
export type MediaRoot = { name: string; path: string }

let _env: Env | null = null

/**
 * Initialize environment variables.
 * Must be called before accessing env.
 */
export function initEnv(): Env {
	const parsed = parseSafe(EnvSchema, Bun.env)

	if (!parsed.success) {
		console.error('❌ Invalid environment variables:')
		for (const issue of parsed.issues) {
			const pathLabel =
				issue.path && issue.path.length > 0
					? issue.path.map((segment) => String(segment)).join('.')
					: '(root)'
			console.error(`  - ${pathLabel}: ${issue.message}`)
		}
		throw new Error('Invalid environment variables')
	}

	_env = parsed.value
	return _env
}

/**
 * Get the parsed environment variables.
 * Throws if initEnv() hasn't been called.
 */
export function getEnv(): Env {
	if (!_env) {
		throw new Error('Environment not initialized. Call initEnv() first.')
	}
	return _env
}

/**
 * Get all configured media roots.
 */
export function getMediaRoots(): Array<MediaRoot> {
	return getEnv().MEDIA_PATHS
}

/**
 * Get a media root by name.
 */
export function getMediaRootByName(name: string): MediaRoot | undefined {
	return getEnv().MEDIA_PATHS.find((root) => root.name === name)
}

/**
 * Find which media root contains a given absolute path.
 * Returns the root and the relative path within it.
 */
export function resolveMediaPath(
	absolutePath: string,
): { root: MediaRoot; relativePath: string } | null {
	const resolved = nodePath.resolve(absolutePath)

	for (const root of getEnv().MEDIA_PATHS) {
		const rootResolved = nodePath.resolve(root.path)
		if (resolved.startsWith(rootResolved + nodePath.sep)) {
			return {
				root,
				relativePath: resolved.slice(rootResolved.length + 1),
			}
		}
		// Handle exact match (file is directly in root)
		if (resolved === rootResolved) {
			return { root, relativePath: '' }
		}
	}

	return null
}

/**
 * Convert a root name and relative path to an absolute path.
 */
export function toAbsolutePath(
	rootName: string,
	relativePath: string,
): string | null {
	const root = getMediaRootByName(rootName)
	if (!root) return null
	return nodePath.join(root.path, relativePath)
}

/**
 * Convert absolute path to mediaRoot:relativePath format.
 */
export function toMediaPath(absolutePath: string): string | null {
	const resolved = resolveMediaPath(absolutePath)
	if (!resolved) return null
	return resolved.relativePath
		? `${resolved.root.name}:${resolved.relativePath}`
		: resolved.root.name
}

/**
 * Parse mediaRoot:relativePath format to components.
 */
export function parseMediaPath(mediaPath: string): {
	mediaRoot: string
	relativePath: string
} {
	const colonIndex = mediaPath.indexOf(':')
	if (colonIndex === -1) {
		return { mediaRoot: mediaPath, relativePath: '' }
	}
	return {
		mediaRoot: mediaPath.slice(0, colonIndex),
		relativePath: mediaPath.slice(colonIndex + 1),
	}
}

/**
 * Get rate limit configuration (requests per minute per IP).
 */
export function getRateLimitConfig() {
	const env = getEnv()
	return {
		adminRead: env.RATE_LIMIT_ADMIN_READ,
		adminWrite: env.RATE_LIMIT_ADMIN_WRITE,
		media: env.RATE_LIMIT_MEDIA,
		default: env.RATE_LIMIT_DEFAULT,
	}
}

/**
 * Get the GitHub repository URL for linking to commits.
 */
export function getGitHubRepo(): string | undefined {
	return getEnv().GITHUB_REPO
}
