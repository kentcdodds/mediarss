import { expect, test } from 'vitest'
import {
	getAppVersion,
	getCommitInfo,
	getDisplayVersion,
	getShortCommitHash,
	getVersionInfo,
} from './version.ts'

test('getAppVersion returns a valid semver version string from package.json', async () => {
	await expect(getAppVersion()).resolves.toMatch(/^\d+\.\d+\.\d+/)
})

test('getCommitInfo returns complete git commit information when in a git repo', async () => {
	const commit = await getCommitInfo()

	// This test assumes we're running in a git repository
	if (commit === null) {
		console.log('Skipping git tests - not in a git repository')
		return
	}

	// Verify all commit info properties
	expect(typeof commit.hash).toBe('string')
	expect(commit.hash).toHaveLength(40) // Full SHA is 40 chars
	expect(typeof commit.shortHash).toBe('string')
	expect(commit.shortHash).toHaveLength(7) // Short SHA is 7 chars
	expect(typeof commit.message).toBe('string')
	expect(typeof commit.date).toBe('string')

	// Date should be ISO format
	expect(new Date(commit.date).toISOString()).toBeTruthy()

	// Short hash should be first 7 characters of full hash
	expect(commit.shortHash).toBe(commit.hash.slice(0, 7))
})

test('getShortCommitHash returns 7 character hash when in git repo', async () => {
	const shortHash = await getShortCommitHash()
	if (shortHash === null) return

	expect(typeof shortHash).toBe('string')
	expect(shortHash).toHaveLength(7)
})

test('getDisplayVersion returns version or short commit hash', async () => {
	const displayVersion = await getDisplayVersion()
	expect(displayVersion).not.toBeNull()
	expect(typeof displayVersion).toBe('string')
	// Should be either semver (version) or 7-char hash
	expect(
		displayVersion!.match(/^\d+\.\d+\.\d+/) || displayVersion!.length === 7,
	).toBeTruthy()
})

test('getVersionInfo returns complete version info object with all required properties', async () => {
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
	expect(typeof info.startTime).toBe('string')
	expect(new Date(info.startTime).toISOString()).toBeTruthy()

	// Uptime should be a positive number
	expect(typeof info.uptimeMs).toBe('number')
	expect(info.uptimeMs).toBeGreaterThanOrEqual(0)
})
