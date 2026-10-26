import { expect, test } from 'vitest'
import { serverMetadata, toolsMetadata } from './metadata.ts'

const liveTokenPath = '/feed/{token}'

test('MCP instructions and token tools document /feed/{token}', () => {
	const descriptions = Object.values(toolsMetadata)
		.map((tool) => tool.description)
		.join('\n')

	expect(serverMetadata.instructions).toContain(liveTokenPath)
	expect(descriptions).toContain(liveTokenPath)

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
