import { expect, test } from 'vitest'
import {
	buildFeedPodcastArtUrl,
	buildItemPodcastArtUrl,
	normalizePodcastArtPath,
} from './podcast-art-url.ts'

test('buildFeedPodcastArtUrl ends with .jpg and puts cache version in the path', () => {
	expect(buildFeedPodcastArtUrl('https://example.com', 'tok', 1710000000)).toBe(
		'https://example.com/art/tok/v/1710000000/feed.jpg',
	)
})

test('buildItemPodcastArtUrl ends with .jpg after the encoded media path', () => {
	expect(
		buildItemPodcastArtUrl(
			'https://example.com',
			'tok',
			'audio',
			'Book/episode.m4b',
			42,
		),
	).toBe('https://example.com/art/tok/v/42/audio/Book%2Fepisode.m4b.jpg')
})

test('normalizePodcastArtPath strips version prefix and image extension', () => {
	expect(normalizePodcastArtPath('v/1710000000/feed.jpg')).toBe('feed')
	expect(normalizePodcastArtPath('v/42/audio/Book%2Fepisode.m4b.jpg')).toBe(
		'audio/Book%2Fepisode.m4b',
	)
	expect(normalizePodcastArtPath('feed.PNG')).toBe('feed')
	expect(normalizePodcastArtPath('feed.jpeg')).toBe('feed')
})

test('normalizePodcastArtPath keeps legacy undecorated paths intact', () => {
	expect(normalizePodcastArtPath('feed')).toBe('feed')
	expect(normalizePodcastArtPath('audio/Book%2Fepisode.m4b')).toBe(
		'audio/Book%2Fepisode.m4b',
	)
})
