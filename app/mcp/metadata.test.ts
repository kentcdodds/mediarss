import { expect, test } from 'vitest'
import { serverMetadata, toolsMetadata } from './metadata.ts'

const brokenQueryTokenPath = '/feed/{feedId}?token='
const liveTokenPath = '/feed/{token}'

test('MCP instructions and token tools document /feed/{token}, not the query-token path', () => {
	const descriptions = Object.values(toolsMetadata)
		.map((tool) => tool.description)
		.join('\n')

	expect(serverMetadata.instructions).toContain(liveTokenPath)
	expect(serverMetadata.instructions).not.toContain(brokenQueryTokenPath)
	expect(descriptions).toContain(liveTokenPath)
	expect(descriptions).not.toContain(brokenQueryTokenPath)
	expect(descriptions).not.toContain('?token=')

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
