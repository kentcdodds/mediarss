import { createHash } from 'node:crypto'
import fs from 'node:fs'
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
 * The version is computed once at module load time and cached.
 */
function computeVersion(): string {
	const rootDir = path.resolve(import.meta.dir, '..', '..')

	// Get app version from package.json
	const packageJsonPath = path.join(rootDir, 'package.json')
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
	const appVersion = packageJson.version || '0.0.0'

	// Get hash of lock file (captures dependency changes)
	const lockFilePath = path.join(rootDir, 'bun.lock')
	let lockHash = 'nolockfile'
	if (fs.existsSync(lockFilePath)) {
		const lockContent = fs.readFileSync(lockFilePath)
		lockHash = createHash('sha256')
			.update(lockContent)
			.digest('hex')
			.slice(0, 8)
	}

	// Combine into a short, URL-safe version string
	// Format: v{appVersion}-{lockHash}
	// Example: v1.8.1-a3b2c1d4
	return `v${appVersion}-${lockHash}`
}

// Compute version at module load time (startup)
const cachedVersion = computeVersion()

/**
 * Get the bundle version string for cache busting.
 * This value is computed once at module load time and cached.
 */
export function getBundleVersion(): string {
	return cachedVersion
}

/**
 * Append the bundle version as a query parameter to a URL path.
 * Uses URL and URLSearchParams for proper encoding and fragment handling.
 *
 * @param urlPath - The URL path (e.g., '/app/client/entry.tsx' or '/page#section')
 * @returns The URL with version query param (e.g., '/app/client/entry.tsx?v=v1.8.1-a3b2c1d4')
 */
export function versionedUrl(urlPath: string): string {
	// Use a dummy base to parse relative paths
	const url = new URL(urlPath, 'http://localhost')
	url.searchParams.set('v', getBundleVersion())
	// Return just the path + search + hash (without the dummy origin)
	return url.pathname + url.search + url.hash
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
