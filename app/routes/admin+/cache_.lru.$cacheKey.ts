import { invariantResponse } from '@epic-web/invariant'
import { lruCache } from '#app/utils/cache.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { type Route } from './+types/cache_.lru.$cacheKey.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')
	const { cacheKey } = params
	invariantResponse(cacheKey, 'cacheKey is required')
	return {
		cacheKey,
		value: lruCache.get(cacheKey),
	}
}
