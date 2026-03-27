import { expect, test } from 'vitest'
import { sortFeeds } from './feed-list-sort.ts'

type MockFeed = {
	id: string
	name: string
	tokenCount: number
	itemCount: number
	lastAccessedAt: number | null
	createdAt: number
	updatedAt: number
}

const feeds: Array<MockFeed> = [
	{
		id: 'feed-a',
		name: 'Alpha',
		tokenCount: 3,
		itemCount: 15,
		lastAccessedAt: 1_000,
		createdAt: 500,
		updatedAt: 900,
	},
	{
		id: 'feed-b',
		name: 'Bravo',
		tokenCount: 1,
		itemCount: 30,
		lastAccessedAt: 2_000,
		createdAt: 700,
		updatedAt: 1_100,
	},
	{
		id: 'feed-c',
		name: 'charlie',
		tokenCount: 3,
		itemCount: 8,
		lastAccessedAt: null,
		createdAt: 800,
		updatedAt: 1_300,
	},
]

test('most-popular sorts by token count, then recency, then file count', () => {
	const sorted = sortFeeds(feeds, 'most-popular')
	expect(sorted.map((feed) => feed.id)).toEqual(['feed-a', 'feed-c', 'feed-b'])
})

test('recently-accessed puts null access times last', () => {
	const sorted = sortFeeds(feeds, 'recently-accessed')
	expect(sorted.map((feed) => feed.id)).toEqual(['feed-b', 'feed-a', 'feed-c'])
})

test('recently-updated sorts by updatedAt descending', () => {
	const sorted = sortFeeds(feeds, 'recently-updated')
	expect(sorted.map((feed) => feed.id)).toEqual(['feed-c', 'feed-b', 'feed-a'])
})

test('name-az sorts case-insensitively by name', () => {
	const sorted = sortFeeds(feeds, 'name-az')
	expect(sorted.map((feed) => feed.name)).toEqual(['Alpha', 'Bravo', 'charlie'])
})
