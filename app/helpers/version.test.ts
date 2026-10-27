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

	expect(commit.hash).toHaveLength(40)
	expect(commit.shortHash).toHaveLength(7)
	expect(typeof commit.message).toBe('string')
	expect(new Date(commit.date).toISOString()).toBeTruthy()

	// Short hash should be first 7 characters of full hash
	expect(commit.shortHash).toBe(commit.hash.slice(0, 7))
	expect(commit.source === 'git' || commit.source === 'env').toBe(true)
})

test('getShortCommitHash returns 7 character hash when in git repo', async () => {
	const shortHash = await getShortCommitHash()
	if (shortHash === null) return

	expect(shortHash).toHaveLength(7)
})

test('getDisplayVersion returns version or short commit hash', async () => {
	const displayVersion = await getDisplayVersion()
	expect(
		displayVersion?.match(/^\d+\.\d+\.\d+/) || displayVersion?.length === 7,
	).toBeTruthy()
})

test('getVersionInfo returns complete version info object with all required properties', async () => {
	const info = await getVersionInfo()

	if (info.version !== null) {
		expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
	}

	expect(new Date(info.startTime).toISOString()).toBeTruthy()
	expect(info.uptimeMs).toBeGreaterThanOrEqual(0)
})

test('getCommitInfo prefers a baked COMMIT_SHA over the local git hash', async () => {
	const previous = process.env.COMMIT_SHA
	process.env.COMMIT_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
	try {
		const commit = await getCommitInfo()
		expect(commit!.source).toBe('env')
		expect(commit!.hash).toBe('abcdef1234567890abcdef1234567890abcdef12')
		expect(commit!.shortHash).toBe('abcdef1')
	} finally {
		if (previous === undefined) delete process.env.COMMIT_SHA
		else process.env.COMMIT_SHA = previous
	}
})
