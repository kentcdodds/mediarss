import fs from 'node:fs'
import path from 'node:path'
import { openFile } from '@mjackson/lazy-file/fs'
import md5 from 'md5-hex'
import * as mimeTypes from 'mime-types'
import * as mm from 'music-metadata'
import pLimit from 'p-limit'
import { z } from 'zod'

const atob = (data: string) => Buffer.from(data, 'base64').toString()

const contributorSchema = z.object({
	name: z.string(),
})

export const AudibleJson64Schema = z.object({
	title: z.string().optional(),
	summary: z.string().optional(),
	author: z.string().optional(),
	copyright: z.string().optional(),
	duration: z.number().optional(),
	narrated_by: z.string().optional(),
	genre: z.string().optional(),
	release_date: z.string().optional(),
})

export const MetadataSchema = z.object({
	id: z.string(),
	title: z.string(),
	author: z.string(),
	pubDate: z.date().optional(),

	description: z.string(),
	content: z.string(),
	category: z.array(z.string()),
	size: z.number(),
	duration: z.number().optional(),
	type: z.string(),
	contentType: z.string(),
	picture: z.custom<mm.IPicture>().optional(),
	contributor: z.array(contributorSchema),

	trackNumber: z.number().optional(),

	copyright: z.string(),
	filepath: z.string(),
})

export type Metadata = z.infer<typeof MetadataSchema>
export type AudibleJson64 = z.infer<typeof AudibleJson64Schema>

function getNativeValue(
	metadata: mm.IAudioMetadata,
	nativeId: string,
): string | undefined {
	for (const nativeMetadata of Object.values(metadata.native)) {
		const foundItem = nativeMetadata.find(
			(item) => item.id.toLowerCase() === nativeId.toLowerCase(),
		)
		if (foundItem) {
			if ((foundItem.value as { text: string }).text) {
				return (foundItem.value as { text: string }).text
			} else {
				return foundItem.value as string
			}
		}
	}
}

export async function getAllFileMetadatas() {
	const files = await getMediaFiles()
	const limit = pLimit(10)
	const items = await Promise.all(
		files.map((file) => limit(() => getFileMetadata(file))),
	)
	return items.filter(Boolean)
}

export async function getFileMetadata(
	filepath: string,
): Promise<Metadata | null> {
	try {
		const stat = await fs.promises.stat(filepath)
		let rawMetadata: mm.IAudioMetadata
		try {
			const file = openFile(filepath)
			rawMetadata = await mm.parseWebStream(file.stream())
		} catch (error: unknown) {
			if (error instanceof Error) {
				error.stack = `This error means that we couldn't parse the metadata for ${filepath}:\n${error.stack}`
			}
			throw error
		}

		const json64 = getNativeValue(rawMetadata, 'TXXX:json64')
		let audibleMetadata: AudibleJson64 = {}
		if (json64) {
			try {
				audibleMetadata = JSON.parse(atob(json64)) as AudibleJson64
			} catch {
				// sometimes the json64 data is incomplete for some reason
			}
		}
		const {
			title = rawMetadata.common.title ?? path.basename(filepath),
			summary: description = rawMetadata.common.description?.join('\n') ??
				rawMetadata.common.comment?.join('\n') ??
				getNativeValue(rawMetadata, 'TXXX:comment') ??
				getNativeValue(rawMetadata, 'COMM:comment') ??
				getNativeValue(rawMetadata, 'COMM') ??
				'No description',
			author = rawMetadata.common.artist ?? 'Unknown author',
			copyright = rawMetadata.common.copyright ?? 'Unknown',
			duration = rawMetadata.format.duration,
			narrated_by: narrators = getNativeValue(
				rawMetadata,
				'----:com.apple.iTunes:PERFORMER_NAME',
			) ??
				getNativeValue(rawMetadata, 'TXXX:narrated_by') ??
				'',
			genre: category = rawMetadata.common.genre?.join(':') ??
				getNativeValue(rawMetadata, 'TXXX:book_genre') ??
				getNativeValue(rawMetadata, 'TXXX:genre') ??
				'',
			release_date: date = getNativeValue(rawMetadata, 'TXXX:year') ??
				getNativeValue(rawMetadata, 'TXXX:date') ??
				rawMetadata.common.date,
		} = audibleMetadata

		const { picture: [picture] = [] } = rawMetadata.common

		const fallbackType =
			path.extname(filepath) === '.m4b'
				? 'audio/mpeg' // officially this should be "audio/mp4a-latm", but it doesn't work 🤷‍♂️
				: 'application/octet-stream'

		let pubDate = date ? new Date(date) : undefined

		const id = md5(filepath)

		const metadata = {
			id,
			title,
			author,
			pubDate,

			description,
			content: description,
			category: category
				.split(':')
				.map((c) => c.trim())
				.filter(Boolean),

			size: stat.size,
			duration,
			type: mimeTypes.lookup(filepath) || fallbackType,
			contentType:
				mimeTypes.contentType(path.extname(filepath)) || fallbackType,
			picture,
			contributor: narrators.split(',').map((name) => ({ name: name.trim() })),

			trackNumber: rawMetadata.common.track.no ?? undefined,

			copyright,
			filepath,
		}
		return metadata
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error(`Trouble getting metadata for "${filepath}"`)
			console.error(error.stack)
		} else {
			console.error(error)
		}
		return null
	}
}

export function getRoots() {
	return process.env.MEDIA_PATHS.split(':')
}

const supportedMediaTypes = ['mp3', 'm4b', 'mp4', 'm4v']

async function getMediaFiles() {
	const ignore = ['@eaDir', '#recycle']
	const mediaGlobPattern = `**/*.{${supportedMediaTypes.join(',')}}`

	const roots = getRoots()
	const result = await Promise.all(
		roots.map(async (dir) => {
			const iterator = fs.promises.glob(path.join(dir, mediaGlobPattern), {
				exclude(fileName) {
					return ignore.some((ignoredDir) => fileName.includes(ignoredDir))
				},
			})
			const files: string[] = []
			for await (const file of iterator) {
				if (typeof file === 'string') {
					files.push(path.resolve(file))
				}
			}
			return files
		}),
	)
	return result.flat()
}

type DirectoryNode =
	| {
			name: string
			id?: never
			type: 'directory'
			children: DirectoryNode[]
	  }
	| {
			name: string
			id: string
			type: 'file'
			children?: never
	  }

async function buildTree(currentPath: string) {
	const ignore = ['@eaDir', '#recycle']
	const entries = await fs.promises.readdir(currentPath, {
		withFileTypes: true,
	})
	const node: DirectoryNode = {
		name: path.basename(currentPath),
		type: 'directory',
		children: [],
	}

	for (const entry of entries) {
		if (ignore.some((ignoredDir) => entry.name.includes(ignoredDir))) {
			continue
		}

		if (entry.isDirectory()) {
			node.children.push(await buildTree(path.join(currentPath, entry.name)))
		} else if (
			supportedMediaTypes.includes(entry.name.split('.').pop() ?? '')
		) {
			node.children.push({
				id: md5(path.join(currentPath, entry.name)),
				name: entry.name,
				type: 'file',
			})
		}
	}

	// Sort directories alphabetically
	node.children.sort((a, b) => a.name.localeCompare(b.name))
	return node
}

export async function getMediaDirectories(): Promise<DirectoryNode[]> {
	const roots = getRoots()
	const result: DirectoryNode[] = []

	for (const root of roots) {
		const rootNode: DirectoryNode = {
			name: path.basename(root),
			type: 'directory',
			children: (await buildTree(root)).children,
		}

		result.push(rootNode)
	}

	return result
}

export async function getFileIdsByDirectory(
	directoryPath: string,
): Promise<string[]> {
	const files = await getMediaFiles()
	const directoryFiles = files.filter((file) => file.startsWith(directoryPath))
	return directoryFiles.map((file) => md5(file))
}

export async function getMetadataById(
	fileId: string,
): Promise<Metadata | null> {
	const files = await getMediaFiles()
	const targetFile = files.find((file) => md5(file) === fileId)
	if (!targetFile) return null
	return getFileMetadata(targetFile)
}
