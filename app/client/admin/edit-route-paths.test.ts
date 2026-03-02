import { expect, test } from 'bun:test'
import {
	getFeedDetailPath,
	getFeedEditPath,
	getMediaDetailPath,
	getMediaEditPath,
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
