import type { Middleware } from '@remix-run/fetch-router'

/**
 * Request logging middleware.
 * Logs each request with duration, resource, method, status code, and content length.
 */
export function logger(): Middleware {
	return async (context, next) => {
		const { request, url } = context
		const startTime = performance.now()

		const response = await next()

		const duration = performance.now() - startTime
		const method = request.method
		const resource = url.pathname + url.search
		const status = response?.status ?? 0
		const contentLength = response?.headers.get('Content-Length') ?? '-'

		const durationStr =
			duration < 1000
				? `${duration.toFixed(1)}ms`
				: `${(duration / 1000).toFixed(2)}s`

		console.log(
			`${method} ${resource} ${status} ${contentLength} ${durationStr}`,
		)

		return response
	}
}
