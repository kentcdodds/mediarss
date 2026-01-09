/**
 * MCP-UI Widget Media Data API endpoint.
 *
 * Returns media metadata for a given path and token.
 * This is used by the media player widget to fetch data when the host
 * (like ChatGPT) doesn't pass the initial-render-data via the MCP-UI protocol.
 *
 * POST /mcp/widget/media-data
 * Body: { mediaRoot: string, relativePath: string, token?: string }
 * Returns: MediaWidgetData | error
 */

import type { Action } from '@remix-run/fetch-router'
import { z } from 'zod'
import { toAbsolutePath } from '#app/config/env.ts'
import type routes from '#app/config/routes.ts'
import { encodeRelativePath, isFileAllowed } from '#app/helpers/feed-access.ts'
import { getFeedByToken } from '#app/helpers/feed-lookup.ts'
import { getFileMetadata } from '#app/helpers/media.ts'
import { getOrigin } from '#app/helpers/origin.ts'
import { parseMediaPathStrict } from '#app/helpers/path-parsing.ts'
import type { MediaWidgetData } from '#app/mcp/widgets.ts'

/**
 * Request body schema
 */
const RequestSchema = z.object({
	mediaRoot: z.string(),
	relativePath: z.string(),
	token: z.string().optional(),
})

/**
 * Find a token for accessing a specific media file.
 * Searches through all feeds to find one that has access to the file,
 * then returns the first active token for that feed.
 */
async function findTokenForMedia(
	rootName: string,
	relativePath: string,
): Promise<string | null> {
	// Import dynamically to avoid circular dependencies
	const { listDirectoryFeeds } = await import(
		'#app/db/directory-feeds.ts'
	)
	const { listActiveDirectoryFeedTokens } = await import(
		'#app/db/directory-feed-tokens.ts'
	)
	const { listCuratedFeeds } = await import('#app/db/curated-feeds.ts')
	const { listActiveCuratedFeedTokens } = await import(
		'#app/db/curated-feed-tokens.ts'
	)

	// Check directory feeds first
	const directoryFeeds = listDirectoryFeeds()
	for (const feed of directoryFeeds) {
		if (isFileAllowed(feed, 'directory', rootName, relativePath)) {
			const tokens = listActiveDirectoryFeedTokens(feed.id)
			if (tokens.length > 0) {
				return tokens[0]!.token
			}
		}
	}

	// Then check curated feeds
	const curatedFeeds = listCuratedFeeds()
	for (const feed of curatedFeeds) {
		if (isFileAllowed(feed, 'curated', rootName, relativePath)) {
			const tokens = listActiveCuratedFeedTokens(feed.id)
			if (tokens.length > 0) {
				return tokens[0]!.token
			}
		}
	}

	return null
}

/**
 * POST /mcp/widget/media-data
 * Returns media metadata for the widget to render.
 */
export default {
	middleware: [],
	async action(context) {
		// Only allow POST
		if (context.request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 })
		}

		// Parse request body
		let body: unknown
		try {
			body = await context.request.json()
		} catch {
			return Response.json(
				{ error: 'Invalid JSON body' },
				{ status: 400 },
			)
		}

		// Validate request
		const parseResult = RequestSchema.safeParse(body)
		if (!parseResult.success) {
			return Response.json(
				{ error: 'Invalid request', details: parseResult.error.issues },
				{ status: 400 },
			)
		}

		const { mediaRoot, relativePath, token: providedToken } = parseResult.data

		// If no token provided, find one automatically
		let token = providedToken
		if (!token) {
			token = await findTokenForMedia(mediaRoot, relativePath) ?? undefined
			if (!token) {
				return Response.json(
					{
						error: 'No access token available',
						message:
							'No feed has access to this media file, or no active tokens exist.',
					},
					{ status: 403 },
				)
			}
		}

		// Validate token and get feed
		const result = getFeedByToken(token)
		if (!result) {
			return Response.json(
				{ error: 'Invalid or expired token' },
				{ status: 401 },
			)
		}

		const { feed, type } = result

		// Parse and validate the path
		const parsed = parseMediaPathStrict(`${mediaRoot}/${relativePath}`)
		if (!parsed) {
			return Response.json(
				{ error: 'Invalid path format' },
				{ status: 400 },
			)
		}

		// Get absolute path for the file
		const filePath = toAbsolutePath(parsed.rootName, parsed.relativePath)
		if (!filePath) {
			return Response.json(
				{ error: 'Unknown media root' },
				{ status: 404 },
			)
		}

		// Validate file is allowed for this feed
		if (!isFileAllowed(feed, type, parsed.rootName, parsed.relativePath)) {
			return Response.json(
				{ error: 'File not found or not accessible' },
				{ status: 404 },
			)
		}

		// Get file metadata
		const metadata = await getFileMetadata(filePath)
		if (!metadata) {
			return Response.json(
				{ error: 'Could not read media file metadata' },
				{ status: 404 },
			)
		}

		// Build token-based URLs
		const encodedPath = encodeRelativePath(
			`${parsed.rootName}/${parsed.relativePath}`,
		)
		const baseUrl = getOrigin(context.request, context.url)

		// Build the response data
		const mediaData: MediaWidgetData = {
			title: metadata.title,
			author: metadata.author,
			duration: metadata.duration,
			sizeBytes: metadata.sizeBytes,
			mimeType: metadata.mimeType,
			publicationDate: metadata.publicationDate?.toISOString() ?? null,
			description: metadata.description,
			narrators: metadata.narrators,
			genres: metadata.genres,
			artworkUrl: `${baseUrl}/art/${token}/${encodedPath}`,
			streamUrl: `${baseUrl}/media/${token}/${encodedPath}`,
		}

		return Response.json(mediaData, {
			headers: {
				'Cache-Control': 'private, max-age=300', // 5 minute cache
			},
		})
	},
} satisfies Action<
	typeof routes.mcpWidgetMediaData.method,
	typeof routes.mcpWidgetMediaData.pattern.source
>
