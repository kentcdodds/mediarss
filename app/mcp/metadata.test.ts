import { expect, test } from 'vitest'
import {
	advertisedPromptNames,
	advertisedToolNames,
	promptsMetadata,
	serverMetadata,
	toolsMetadata,
} from './metadata.ts'

const liveTokenPath = '/feed/{token}'

test('MCP instructions and token tools document /feed/{token}', () => {
	expect(serverMetadata.instructions).toContain(liveTokenPath)

	expect(toolsMetadata.get_feed_tokens.description).toContain(liveTokenPath)
	expect(toolsMetadata.get_feed_tokens.description).toContain('rssUrl')
	expect(toolsMetadata.create_feed_token.description).toContain(liveTokenPath)
	expect(toolsMetadata.create_feed_token.description).toContain('rssUrl')
	expect(toolsMetadata.create_feed_token.description).toMatch(/label/i)
	expect(toolsMetadata.create_directory_feed.description).toContain(
		liveTokenPath,
	)
	expect(toolsMetadata.create_curated_feed.description).toContain(liveTokenPath)
})

test('media://server capability names stay derived from the catalogs', () => {
	expect(advertisedToolNames).toEqual(Object.keys(toolsMetadata))
	expect(advertisedPromptNames).toEqual(Object.keys(promptsMetadata))
	expect(advertisedToolNames).toEqual(
		expect.arrayContaining([
			'search_media',
			'get_media_metadata',
			'update_media_metadata',
			'add_media_to_feeds',
			'remove_media_from_feeds',
		]),
	)
})
