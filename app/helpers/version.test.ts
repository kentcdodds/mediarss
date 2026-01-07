import { expect, test } from 'bun:test'
import {
	getAppVersion,
	getCommitInfo,
	getDisplayVersion,
	getShortCommitHash,
	getVersionInfo,
} from './version.ts'

test('getAppVersion returns a valid semver version string from package.json', async () => {
	const version = await getAppVersion()
	expect(version).not.toBeNull()
	// Basic semver pattern check (e.g., "1.0.0" or "0.1.0")
	expect(version).toMatch(/^\d+\.\d+\.\d+/)
})

test('getCommitInfo returns commit hash, message, and date when in git repo', async () => {
	const commit = await getCommitInfo()

	// This test assumes we're running in a git repository
	// If not in a git repo, commit will be null
	if (commit === null) {
		// Skip assertions if not in a git repo
		console.log('Skipping git tests - not in a git repository')
		return
	}

	expect(commit.hash).toBeString()
	expect(commit.hash).toHaveLength(40) // Full SHA is 40 chars
	expect(commit.shortHash).toBeString()
	expect(commit.shortHash).toHaveLength(7) // Short SHA is 7 chars
	expect(commit.message).toBeString()
	expect(commit.date).toBeString()
	// Date should be ISO format
	expect(new Date(commit.date).toISOString()).toBeTruthy()
})

test('getCommitInfo short hash is first 7 characters of full hash', async () => {
	const commit = await getCommitInfo()
	if (commit === null) return

	expect(commit.shortHash).toBe(commit.hash.slice(0, 7))
})

test('getShortCommitHash returns 7 character hash when in git repo', async () => {
	const shortHash = await getShortCommitHash()
	if (shortHash === null) return

	expect(shortHash).toBeString()
	expect(shortHash).toHaveLength(7)
})

test('getDisplayVersion returns version or short commit hash', async () => {
	const displayVersion = await getDisplayVersion()
	expect(displayVersion).not.toBeNull()
	expect(displayVersion).toBeString()
	// Should be either semver (version) or 7-char hash
	expect(
		displayVersion!.match(/^\d+\.\d+\.\d+/) || displayVersion!.length === 7,
	).toBeTruthy()
})

test('getVersionInfo returns complete version info object', async () => {
	const info = await getVersionInfo()

	expect(info).toHaveProperty('version')
	expect(info).toHaveProperty('commit')
	expect(info).toHaveProperty('startTime')
	expect(info).toHaveProperty('uptimeMs')

	// Version should be a string or null
	if (info.version !== null) {
		expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
	}

	// Start time should be valid ISO date string
	expect(info.startTime).toBeString()
	expect(new Date(info.startTime).toISOString()).toBeTruthy()

	// Uptime should be a positive number
	expect(info.uptimeMs).toBeNumber()
	expect(info.uptimeMs).toBeGreaterThanOrEqual(0)
})
