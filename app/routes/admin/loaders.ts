import {
	noAdminRouteLoaderData,
	type AdminRouteLoaderData,
} from '#app/client/admin/loader-data.ts'
import { getAdminDirectoriesData } from '#app/routes/admin/api/directories.ts'
import { getAdminFeedsData } from '#app/routes/admin/api/feeds.ts'
import { getAdminMediaData } from '#app/routes/admin/api/media.ts'
import { getAdminMediaAssignmentsData } from '#app/routes/admin/api/media-assignments.ts'
import { getAdminVersionData } from '#app/routes/admin/api/version.ts'

export async function loadAdminRouteData(request: Request) {
	const url = new URL(request.url)

	if (url.pathname === '/admin') {
		return {
			type: 'feeds',
			data: await getAdminFeedsData(),
		} satisfies AdminRouteLoaderData
	}

	if (url.pathname === '/admin/feeds/new') {
		return {
			type: 'create-feed',
			data: getAdminDirectoriesData(),
		} satisfies AdminRouteLoaderData
	}

	if (url.pathname === '/admin/media') {
		const [media, assignments] = await Promise.all([
			getAdminMediaData(),
			getAdminMediaAssignmentsData(),
		])
		return {
			type: 'media-list',
			data: { media, assignments },
		} satisfies AdminRouteLoaderData
	}

	if (url.pathname === '/admin/version') {
		return {
			type: 'version',
			data: await getAdminVersionData(),
		} satisfies AdminRouteLoaderData
	}

	return noAdminRouteLoaderData
}
