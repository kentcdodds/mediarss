#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import semver from 'semver'
import { execCommand } from '#app/helpers/exec.ts'

type SemverType = 'major' | 'minor' | 'patch'

const VALID_TYPES: SemverType[] = ['major', 'minor', 'patch']

async function main() {
	const semverType = process.argv[2] as SemverType

	// Validate input
	if (!semverType || !VALID_TYPES.includes(semverType)) {
		console.error(`Usage: node scripts/release.ts <major|minor|patch>`)
		console.error(`Received: ${semverType || '(none)'}`)
		process.exit(1)
	}

	// Read current package.json
	const packageJsonPath = new URL('../package.json', import.meta.url).pathname
	const packageJson = JSON.parse(
		await readFile(packageJsonPath, 'utf8'),
	) as Record<string, unknown>
	const currentVersion = packageJson.version as string

	if (!currentVersion) {
		console.error('No version field found in package.json')
		process.exit(1)
	}

	// Calculate new version
	const newVersion = semver.inc(currentVersion, semverType)
	if (!newVersion) {
		console.error(
			`Failed to increment version ${currentVersion} with type ${semverType}`,
		)
		process.exit(1)
	}

	console.log(`Bumping version: ${currentVersion} → ${newVersion}`)

	// Update package.json
	packageJson.version = newVersion
	await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
	console.log('✓ Updated package.json')

	// Git operations
	const tagName = `v${newVersion}`

	// Stage package.json
	await execCommand('git', ['add', 'package.json'])
	console.log('✓ Staged package.json')

	// Create commit
	await execCommand('git', ['commit', '-m', `release: ${tagName}`])
	console.log(`✓ Created commit: release: ${tagName}`)

	// Create tag
	await execCommand('git', ['tag', '-a', tagName, '-m', `Release ${tagName}`])
	console.log(`✓ Created tag: ${tagName}`)

	// Push commit and tag
	await execCommand('git', ['push'])
	console.log('✓ Pushed commit')

	await execCommand('git', ['push', 'origin', tagName])
	console.log(`✓ Pushed tag: ${tagName}`)

	// Create GitHub release using gh CLI or the API
	const githubToken = process.env.GITHUB_TOKEN
	const repo = process.env.GITHUB_REPOSITORY

	if (githubToken && repo) {
		console.log('Creating GitHub release...')

		// Generate release notes from commits since last tag
		let releaseNotes = `Release ${tagName}`
		try {
			const previousTagResult = await execCommand('git', [
				'describe',
				'--tags',
				'--abbrev=0',
				`${tagName}^`,
			])
			const previousTag = previousTagResult.stdout.trim()
			if (previousTag.trim()) {
				const commitsResult = await execCommand('git', [
					'log',
					`${previousTag.trim()}..${tagName}`,
					'--pretty=format:- %s',
					'--no-merges',
				])
				const commits = commitsResult.stdout
				if (commits.trim()) {
					releaseNotes = `## What's Changed\n\n${commits.trim()}`
				}
			}
		} catch {
			// No previous tag or error getting commits, use default release notes
		}

		const releaseData = {
			tag_name: tagName,
			name: tagName,
			body: releaseNotes,
			draft: false,
			prerelease: false,
		}

		const response = await fetch(
			`https://api.github.com/repos/${repo}/releases`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${githubToken}`,
					'Content-Type': 'application/json',
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				body: JSON.stringify(releaseData),
			},
		)

		if (response.ok) {
			const release = (await response.json()) as { html_url: string }
			console.log(`✓ Created GitHub release: ${release.html_url}`)
		} else {
			const error = await response.text()
			console.error(
				`Failed to create GitHub release: ${response.status} ${error}`,
			)
			process.exit(1)
		}
	} else {
		console.log(
			'ℹ️  Skipping GitHub release creation (GITHUB_TOKEN or GITHUB_REPOSITORY not set)',
		)
		console.log(
			'   Run this script in GitHub Actions to create releases automatically.',
		)
	}

	console.log(`\n🎉 Successfully released ${tagName}!`)
}

main().catch((error) => {
	console.error('Release failed:', error)
	process.exit(1)
})
