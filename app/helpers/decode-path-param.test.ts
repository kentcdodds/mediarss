import { expect, test } from 'bun:test'
import { decodePathParam } from './decode-path-param.ts'

test('decodePathParam decodes valid encoded segments', () => {
	expect(decodePathParam('audio%2Fepisode%201.mp3')).toBe('audio/episode 1.mp3')
	expect(decodePathParam('plain/path.mp3')).toBe('plain/path.mp3')
})

test('decodePathParam returns null for malformed encoding', () => {
	expect(decodePathParam('%E0%A4%A')).toBeNull()
	expect(decodePathParam('%')).toBeNull()
})
