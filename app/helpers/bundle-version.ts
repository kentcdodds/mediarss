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
 * The version is computed once at startup and cached.
 */

let cachedVersion: string | null = null

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

/**
 * Get the bundle version string for cache busting.
 * This value is computed once at startup and cached.
 */
export function getBundleVersion(): string {
	if (cachedVersion === null) {
		cachedVersion = computeVersion()
	}
	return cachedVersion
}

/**
 * Append the bundle version as a query parameter to a URL path.
 *
 * @param urlPath - The URL path (e.g., '/app/client/entry.tsx')
 * @returns The URL with version query param (e.g., '/app/client/entry.tsx?v=v1.8.1-a3b2c1d4')
 */
export function versionedUrl(urlPath: string): string {
	const version = getBundleVersion()
	const separator = urlPath.includes('?') ? '&' : '?'
	return `${urlPath}${separator}v=${version}`
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
