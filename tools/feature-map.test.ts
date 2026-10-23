import { expect, test } from 'vitest'
import { checkFeatureMap } from './feature-map.ts'

test('the Feature Map covers every route and matches the committed file', async () => {
	expect(await checkFeatureMap()).toEqual([])
})
