/**
 * MCP tools for reading and editing a single media file's metadata.
 * They share validation, path containment, and the FFmpeg write with the
 * admin `PUT /admin/api/media/*path/metadata` endpoint.
 */

import { type McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
	applyMediaMetadataUpdate,
	EDITABLE_METADATA_FIELDS,
	readMediaMetadata,
} from '#app/helpers/media-metadata-edit.ts'
import { type AuthInfo, hasScope } from './auth.ts'
import { toolsMetadata } from './metadata.ts'

const mediaLocationShape = {
	mediaRoot: z
		.string()
		.describe('Name of the media root (from `list_media_directories`)'),
	relativePath: z.string().describe('Path to the media file within the root'),
}

const editableFieldsShape = {
	title: z.string().optional(),
	author: z.string().optional(),
	description: z.string().optional(),
	date: z
		.string()
		.optional()
		.describe('Release date: "YYYY", "YYYY-MM", or "YYYY-MM-DD"'),
	genre: z.string().optional(),
	trackNumber: z.number().int().nonnegative().optional(),
	copyright: z.string().optional(),
	narrator: z.string().optional(),
	album: z.string().optional(),
	albumArtist: z.string().optional(),
	composer: z.string().optional(),
	publisher: z.string().optional(),
	discNumber: z.number().int().nonnegative().optional(),
	language: z.string().optional(),
	series: z.string().optional(),
	seriesPosition: z.string().optional(),
	encodedBy: z.string().optional(),
	subtitle: z.string().optional(),
}

function errorResult(message: string, details?: string[]) {
	const text = details?.length
		? `❌ ${message}\n\n${details.map((d) => `- ${d}`).join('\n')}`
		: `❌ ${message}`
	return {
		content: [{ type: 'text' as const, text }],
		structuredContent: { error: message, ...(details ? { details } : {}) },
		isError: true,
	}
}

export type MediaMetadataToolInput = {
	mediaRoot: string
	relativePath: string
} & Partial<Record<(typeof EDITABLE_METADATA_FIELDS)[number], unknown>>

export async function getMediaMetadataTool({
	mediaRoot,
	relativePath,
}: {
	mediaRoot: string
	relativePath: string
}) {
	const result = await readMediaMetadata(mediaRoot, relativePath)
	if (!result.ok) return errorResult(result.error, result.details)
	const { detail } = result
	const lines = [
		`## ${detail.title}`,
		'',
		`- **Path**: ${mediaRoot}:${relativePath}`,
		`- **Author**: ${detail.author ?? '—'}`,
		`- **Publication date**: ${detail.publicationDate ?? '—'}`,
		`- **Track**: ${detail.trackNumber ?? '—'}`,
		`- **Album**: ${detail.album ?? '—'}`,
		`- **Description**: ${detail.description ?? '—'}`,
	]
	return {
		content: [{ type: 'text' as const, text: lines.join('\n') }],
		structuredContent: { media: detail },
		isError: false,
	}
}

export async function updateMediaMetadataTool(input: MediaMetadataToolInput) {
	const { mediaRoot, relativePath, ...rest } = input
	const update: Record<string, unknown> = {}
	for (const field of EDITABLE_METADATA_FIELDS) {
		if (rest[field] !== undefined) update[field] = rest[field]
	}
	const result = await applyMediaMetadataUpdate(mediaRoot, relativePath, update)
	if (!result.ok) return errorResult(result.error, result.details)
	const { media, assignments } = result.response
	const changed = Object.keys(update)
	const lines = [
		`✅ Updated ${changed.join(', ')} on ${mediaRoot}:${relativePath}`,
		'',
		`- **Title**: ${media.title}`,
		`- **Publication date**: ${media.publicationDate ?? '—'}`,
		`- **Description**: ${media.description ?? '—'}`,
		'',
		'Next: Use `get_media_metadata` to verify the change.',
	]
	return {
		content: [{ type: 'text' as const, text: lines.join('\n') }],
		structuredContent: { media, assignments, updatedFields: changed },
		isError: false,
	}
}

export function registerMediaMetadataTools(
	server: Pick<McpServer, 'registerTool'>,
	authInfo: AuthInfo,
): void {
	if (hasScope(authInfo, 'mcp:read')) {
		server.registerTool(
			toolsMetadata.get_media_metadata.name,
			{
				title: toolsMetadata.get_media_metadata.title,
				description: toolsMetadata.get_media_metadata.description,
				inputSchema: z.object(mediaLocationShape),
				annotations: { readOnlyHint: true, destructiveHint: false },
			},
			getMediaMetadataTool,
		)
	}

	if (hasScope(authInfo, 'mcp:write')) {
		server.registerTool(
			toolsMetadata.update_media_metadata.name,
			{
				title: toolsMetadata.update_media_metadata.title,
				description: toolsMetadata.update_media_metadata.description,
				inputSchema: z.object({
					...mediaLocationShape,
					...editableFieldsShape,
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: true,
				},
			},
			updateMediaMetadataTool,
		)
	}
}
