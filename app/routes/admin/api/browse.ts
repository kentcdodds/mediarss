import fs from 'node:fs'
import nodePath from 'node:path'
import type { Action } from '@remix-run/fetch-router'
import { getMediaRootByName } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'

type DirectoryEntry = {
	name: string
	type: 'directory' | 'file'
}

/**
 * GET /admin/api/browse?root=<name>&path=<relative-path>
 * Returns list of entries (directories and files) at the specified path
 * within the given media root.
 */
export default {
	middleware: [],
	action(context) {
		const url = context.url
		const rootName = url.searchParams.get('root')
		const relativePath = url.searchParams.get('path') ?? ''

		if (!rootName) {
			return Response.json(
				{ error: 'Missing required "root" parameter' },
				{ status: 400 },
			)
		}

		const mediaRoot = getMediaRootByName(rootName)
		if (!mediaRoot) {
			return Response.json(
				{ error: `Media root "${rootName}" not found` },
				{ status: 404 },
			)
		}

		// Resolve the target path and validate it's within the media root
		const rootResolved = nodePath.resolve(mediaRoot.path)
		const targetPath = nodePath.resolve(mediaRoot.path, relativePath)

		// Security: ensure the target path is within the media root
		if (
			!targetPath.startsWith(rootResolved + nodePath.sep) &&
			targetPath !== rootResolved
		) {
			return Response.json(
				{ error: 'Path traversal not allowed' },
				{ status: 403 },
			)
		}

		// Check if directory exists
		if (!fs.existsSync(targetPath)) {
			return Response.json({ error: 'Directory not found' }, { status: 404 })
		}

		const stat = fs.statSync(targetPath)
		if (!stat.isDirectory()) {
			return Response.json(
				{ error: 'Path is not a directory' },
				{ status: 400 },
			)
		}

		// Read directory entries
		const entries: Array<DirectoryEntry> = []
		const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true })

		for (const entry of dirEntries) {
			// Skip hidden files/directories
			if (entry.name.startsWith('.')) continue

			entries.push({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file',
			})
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1
			}
			return a.name.localeCompare(b.name)
		})

		return Response.json({
			root: rootName,
			path: relativePath,
			entries,
		})
	},
} satisfies Action<
	typeof routes.adminApiBrowse.method,
	typeof routes.adminApiBrowse.pattern.source
>
