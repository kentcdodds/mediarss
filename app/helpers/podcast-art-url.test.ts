import { expect, test } from 'vitest'
import {
	buildFeedPodcastArtUrl,
	buildItemPodcastArtUrl,
	getPodcastArtExtension,
	normalizePodcastArtPath,
} from './podcast-art-url.ts'

test('getPodcastArtExtension maps source MIME to the served URL extension', () => {
	expect(getPodcastArtExtension('image/jpeg')).toBe('jpg')
	expect(getPodcastArtExtension('image/png')).toBe('png')
	expect(getPodcastArtExtension('image/webp')).toBe('webp')
	// Unknown / non-podcast formats are normalized to JPEG by squaring
	expect(getPodcastArtExtension('image/gif')).toBe('jpg')
})

test('buildFeedPodcastArtUrl uses an extension matching the artwork MIME', () => {
	expect(
		buildFeedPodcastArtUrl(
			'https://example.com',
			'tok',
			1710000000,
			'image/png',
		),
	).toBe('https://example.com/art/tok/v/1710000000/feed.png')
	expect(
		buildFeedPodcastArtUrl(
			'https://example.com',
			'tok',
			1710000000,
			'image/webp',
		),
	).toBe('https://example.com/art/tok/v/1710000000/feed.webp')
	expect(
		buildFeedPodcastArtUrl(
			'https://example.com',
			'tok',
			1710000000,
			'image/jpeg',
		),
	).toBe('https://example.com/art/tok/v/1710000000/feed.jpg')
})

test('buildItemPodcastArtUrl uses an extension matching the artwork MIME', () => {
	expect(
		buildItemPodcastArtUrl(
			'https://example.com',
			'tok',
			'audio',
			'Book/episode.m4b',
			42,
			'image/png',
		),
	).toBe('https://example.com/art/tok/v/42/audio/Book%2Fepisode.m4b.png')
})

test('normalizePodcastArtPath strips version prefix and image extension', () => {
	expect(normalizePodcastArtPath('v/1710000000/feed.jpg')).toBe('feed')
	expect(normalizePodcastArtPath('v/42/audio/Book%2Fepisode.m4b.png')).toBe(
		'audio/Book%2Fepisode.m4b',
	)
	expect(normalizePodcastArtPath('feed.PNG')).toBe('feed')
	expect(normalizePodcastArtPath('feed.jpeg')).toBe('feed')
	expect(normalizePodcastArtPath('feed.webp')).toBe('feed')
})

test('normalizePodcastArtPath keeps legacy undecorated paths intact', () => {
	expect(normalizePodcastArtPath('feed')).toBe('feed')
	expect(normalizePodcastArtPath('audio/Book%2Fepisode.m4b')).toBe(
		'audio/Book%2Fepisode.m4b',
	)
	// A media root named `v` must not be treated as a cache-bust prefix
	// unless the URL also ends with an image extension (new format).
	expect(normalizePodcastArtPath('v/123/episode.m4b')).toBe('v/123/episode.m4b')
})
