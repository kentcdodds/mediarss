import { getOrigin } from '#app/helpers/origin.ts'

export function getAdminRedirectUrl(request: Request): URL {
	const requestUrl = new URL(request.url)
	return new URL('/admin', getOrigin(request, requestUrl))
}

export function createAdminRedirectResponse(request: Request): Response {
	return Response.redirect(getAdminRedirectUrl(request), 302)
}
