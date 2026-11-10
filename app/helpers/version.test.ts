import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { setEnvVar } from '#test/test-helpers.ts'
import { getAppVersion, getCommitInfo, getVersionInfo } from './version.ts'

const execFileAsync = promisify(execFile)
const bakedSha = 'abcdef1234567890abcdef1234567890abcdef12'
const sourceCommitSha = '1234567890abcdef1234567890abcdef12345678'

function restoreCommitEnv() {
	const previousSha = process.env.COMMIT_SHA
	const previousSource = process.env.SOURCE_COMMIT
	return {
		[Symbol.dispose]() {
			setEnvVar('COMMIT_SHA', previousSha)
			setEnvVar('SOURCE_COMMIT', previousSource)
		},
	}
}

function withoutBakedCommit() {
	const restore = restoreCommitEnv()
	setEnvVar('COMMIT_SHA', undefined)
	setEnvVar('SOURCE_COMMIT', undefined)
	return restore
}

async function packageJsonVersion() {
	const pkg = JSON.parse(
		await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
	) as { version: string }
	return pkg.version
}

async function gitHeadCommit() {
	const [{ stdout: hash }, { stdout: message }, { stdout: date }] =
		await Promise.all([
			execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }),
			execFileAsync('git', ['log', '-1', '--format=%B'], {
				cwd: process.cwd(),
			}),
			execFileAsync('git', ['log', '-1', '--format=%cI'], {
				cwd: process.cwd(),
			}),
		])
	const gitHash = hash.trim()
	return {
		hash: gitHash,
		shortHash: gitHash.slice(0, 7),
		message: message.trim(),
		date: date.trim(),
		source: 'git' as const,
	}
}

function bakedCommit(sha: string, startTime: string) {
	return {
		hash: sha,
		shortHash: sha.slice(0, 7),
		message: 'baked at image build',
		date: startTime,
		source: 'env' as const,
	}
}

test('getAppVersion returns the version field from package.json', async () => {
	await expect(getAppVersion()).resolves.toBe(await packageJsonVersion())
})

test('getCommitInfo returns the HEAD commit from git when no baked SHA is set', async () => {
	using _env = withoutBakedCommit()
	await expect(getCommitInfo()).resolves.toEqual(await gitHeadCommit())
})

test('getVersionInfo composes package.json version, commit, start time, and uptime', async () => {
	using _env = withoutBakedCommit()
	const [info, version, commit] = await Promise.all([
		getVersionInfo(),
		packageJsonVersion(),
		gitHeadCommit(),
	])

	expect(info.version).toBe(version)
	expect(info.commit).toEqual(commit)
	expect(info.startTime).toBe(new Date(info.startTime).toISOString())
	expect(
		Math.abs(info.uptimeMs - (Date.now() - Date.parse(info.startTime))),
	).toBeLessThan(1000)
})

test('getCommitInfo prefers a baked COMMIT_SHA over git and SOURCE_COMMIT', async () => {
	using _env = restoreCommitEnv()
	setEnvVar('COMMIT_SHA', `  ${bakedSha}  `)
	setEnvVar('SOURCE_COMMIT', sourceCommitSha)

	const [commit, info] = await Promise.all([getCommitInfo(), getVersionInfo()])
	const expected = bakedCommit(bakedSha, info.startTime)
	expect(commit).toEqual(expected)
	expect(info.commit).toEqual(expected)
})

test('getCommitInfo uses SOURCE_COMMIT when COMMIT_SHA is unset', async () => {
	using _env = restoreCommitEnv()
	setEnvVar('COMMIT_SHA', undefined)
	setEnvVar('SOURCE_COMMIT', sourceCommitSha)

	const info = await getVersionInfo()
	await expect(getCommitInfo()).resolves.toEqual(
		bakedCommit(sourceCommitSha, info.startTime),
	)
})

test('getCommitInfo ignores invalid baked SHAs and falls back to git', async () => {
	using _env = restoreCommitEnv()
	setEnvVar('COMMIT_SHA', 'not-a-sha')
	setEnvVar('SOURCE_COMMIT', 'abc')

	await expect(getCommitInfo()).resolves.toEqual(await gitHeadCommit())
})
