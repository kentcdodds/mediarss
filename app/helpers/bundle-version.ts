import { createHash } from 'node:crypto'
import path from 'node:path'

/**
 * Compute a cache-busting version string for bundled assets.
 *
 * The version is based on:
 * 1. The app version from package.json
 * 2. A hash of the bun.lock file (captures dependency changes)
 *
 * This ensures cache invalidation when either:
 * - The app version is bumped (new release)
 * - Dependencies are updated (lock file changes)
 *
 * The version is computed once at startup and cached.
 */

let cachedVersion: string | null = null

async function computeVersion(): Promise<string> {
	const rootDir = path.resolve(import.meta.dir, '..', '..')

	// Get app version from package.json
	const packageJsonPath = path.join(rootDir, 'package.json')
	const packageJsonText = await Bun.file(packageJsonPath).text()
	const packageJson = JSON.parse(packageJsonText)
	const appVersion = packageJson.version || '0.0.0'

	// Get hash of lock file (captures dependency changes)
	const lockFilePath = path.join(rootDir, 'bun.lock')
	let lockHash = 'nolockfile'
	const lockFile = Bun.file(lockFilePath)
	if (await lockFile.exists()) {
		const lockContent = await lockFile.arrayBuffer()
		lockHash = createHash('sha256')
			.update(new Uint8Array(lockContent))
			.digest('hex')
			.slice(0, 8)
	}

	// Combine into a short, URL-safe version string
	// Format: v{appVersion}-{lockHash}
	// Example: v1.8.1-a3b2c1d4
	return `v${appVersion}-${lockHash}`
}

/**
 * Initialize the bundle version at startup.
 * This must be called before any calls to getBundleVersion().
 */
export async function initBundleVersion(): Promise<void> {
	if (cachedVersion === null) {
		cachedVersion = await computeVersion()
	}
}

/**
 * Get the bundle version string for cache busting.
 * This value is computed once at startup and cached.
 * initBundleVersion() must be called before using this function.
 */
export function getBundleVersion(): string {
	if (cachedVersion === null) {
		throw new Error(
			'Bundle version not initialized. Call initBundleVersion() at startup.',
		)
	}
	return cachedVersion
}

/**
 * Append the bundle version as a query parameter to a URL path.
 * Handles fragment identifiers (#) correctly by inserting the query param before the fragment.
 * URL-encodes the version to handle special characters like '+'.
 *
 * @param urlPath - The URL path (e.g., '/app/client/entry.tsx' or '/page#section')
 * @returns The URL with version query param (e.g., '/app/client/entry.tsx?v=v1.8.1-a3b2c1d4')
 */
export function versionedUrl(urlPath: string): string {
	const version = encodeURIComponent(getBundleVersion())

	// Split URL into base and fragment parts
	const fragmentIndex = urlPath.indexOf('#')
	let base: string
	let fragment: string

	if (fragmentIndex !== -1) {
		base = urlPath.slice(0, fragmentIndex)
		fragment = urlPath.slice(fragmentIndex)
	} else {
		base = urlPath
		fragment = ''
	}

	// Append version query param to base
	const separator = base.includes('?') ? '&' : '?'
	return `${base}${separator}v=${version}${fragment}`
}

/**
 * Create a versioned import map by appending version to all import URLs.
 *
 * @param imports - The base import map
 * @returns The import map with versioned URLs
 */
export function versionedImportMap(
	imports: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(imports).map(([key, value]) => [key, versionedUrl(value)]),
	)
}
