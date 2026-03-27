import { expect, test } from 'vitest'
import {
	getFeedDetailPath,
	getFeedEditPath,
	getMediaDetailPath,
	getMediaEditPath,
	getMediaFetchPaths,
	isFeedEditPath,
	parseMediaDetailRoutePath,
} from './edit-route-paths.ts'

test('feed edit route helpers build and detect edit path', () => {
	const feedId = 'feed-123'

	expect(getFeedDetailPath(feedId)).toBe('/admin/feeds/feed-123')
	expect(getFeedEditPath(feedId)).toBe('/admin/feeds/feed-123/edit')
	expect(isFeedEditPath('/admin/feeds/feed-123/edit', feedId)).toBe(true)
	expect(isFeedEditPath('/admin/feeds/feed-123', feedId)).toBe(false)
})

test('media edit route helpers build expected paths', () => {
	const mediaPath = 'audio/sample-tone.mp3'

	expect(getMediaDetailPath(mediaPath)).toBe(
		'/admin/media/audio/sample-tone.mp3',
	)
	expect(getMediaEditPath(mediaPath)).toBe(
		'/admin/media/audio/sample-tone.mp3/edit',
	)
})

test('parseMediaDetailRoutePath parses detail and edit routes', () => {
	expect(
		parseMediaDetailRoutePath('/admin/media/audio/sample-tone.mp3'),
	).toEqual({
		paramPath: 'audio/sample-tone.mp3',
		isEditRoute: false,
	})

	expect(
		parseMediaDetailRoutePath('/admin/media/audio/sample-tone.mp3/edit'),
	).toEqual({
		paramPath: 'audio/sample-tone.mp3',
		isEditRoute: true,
	})
})

test('parseMediaDetailRoutePath ignores non-media routes', () => {
	expect(parseMediaDetailRoutePath('/admin/feeds/feed-123/edit')).toEqual({
		paramPath: '',
		isEditRoute: false,
	})
})

test('getMediaFetchPaths uses raw edit path with stripped fallback', () => {
	expect(getMediaFetchPaths('/admin/media/audio/sample-tone.mp3/edit')).toEqual(
		{
			rawPath: 'audio/sample-tone.mp3/edit',
			paramPath: 'audio/sample-tone.mp3',
			hasEditSuffix: true,
			fetchPath: 'audio/sample-tone.mp3/edit',
			fallbackPath: 'audio/sample-tone.mp3',
		},
	)
})

test('getMediaFetchPaths omits fallback for non-edit routes', () => {
	expect(getMediaFetchPaths('/admin/media/audio/sample-tone.mp3')).toEqual({
		rawPath: 'audio/sample-tone.mp3',
		paramPath: 'audio/sample-tone.mp3',
		hasEditSuffix: false,
		fetchPath: 'audio/sample-tone.mp3',
		fallbackPath: undefined,
	})
})
