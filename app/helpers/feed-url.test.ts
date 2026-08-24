import { expect, test } from 'vitest'
import {
	buildFeedRssPath,
	buildFeedRssUrl,
	displayTokenLabel,
} from './feed-url.ts'

test('buildFeedRssPath uses the token-only /feed/{token} shape', () => {
	expect(buildFeedRssPath('ZmayrMaOueHNO_lKU0Nc16k6xxT7p3kA4MAkqGldf7c')).toBe(
		'/feed/ZmayrMaOueHNO_lKU0Nc16k6xxT7p3kA4MAkqGldf7c',
	)
	expect(buildFeedRssPath('abc')).toBe('/feed/abc')
})

test('buildFeedRssUrl prefixes the origin without a feedId or query token', () => {
	expect(
		buildFeedRssUrl(
			'https://mediarss.doddsfamily.us',
			'ZmayrMaOueHNO_lKU0Nc16k6xxT7p3kA4MAkqGldf7c',
		),
	).toBe(
		'https://mediarss.doddsfamily.us/feed/ZmayrMaOueHNO_lKU0Nc16k6xxT7p3kA4MAkqGldf7c',
	)
	expect(buildFeedRssUrl('http://localhost:22050', 'tok')).toBe(
		'http://localhost:22050/feed/tok',
	)
})

test('displayTokenLabel surfaces supplied names and falls back to Unlabeled', () => {
	expect(displayTokenLabel('Nathan')).toBe('Nathan')
	expect(displayTokenLabel('  iPhone  ')).toBe('iPhone')
	expect(displayTokenLabel('')).toBe('Unlabeled')
	expect(displayTokenLabel('   ')).toBe('Unlabeled')
	expect(displayTokenLabel(undefined)).toBe('Unlabeled')
	expect(displayTokenLabel(null)).toBe('Unlabeled')
})
