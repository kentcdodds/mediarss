export type ControlRequestInit = {
	json?: unknown
	body?: BodyInit
	headers?: Record<string, string>
}

export type ControlContext = {
	origin: string
	params: Record<string, unknown>
	/** Raw fetch against the control origin. Redirects are not followed. */
	request: (
		method: string,
		pathname: string,
		init?: ControlRequestInit,
	) => Promise<Response>
	/** Fetch and parse JSON; throws with the response body on a non-2xx status. */
	json: <T = unknown>(
		method: string,
		pathname: string,
		body?: unknown,
	) => Promise<T>
}

export function createControlContext(
	origin: string,
	params: Record<string, unknown> = {},
): ControlContext {
	const request: ControlContext['request'] = (method, pathname, init = {}) => {
		const headers = new Headers(init.headers)
		let body = init.body
		if (init.json !== undefined) {
			headers.set('content-type', 'application/json')
			body = JSON.stringify(init.json)
		}
		const hasBody = method !== 'GET' && method !== 'HEAD'
		return fetch(new URL(pathname, origin), {
			method,
			headers,
			...(hasBody ? { body } : {}),
			redirect: 'manual',
		})
	}

	return {
		origin,
		params,
		request,
		async json(method, pathname, body) {
			const response = await request(
				method,
				pathname,
				body === undefined ? {} : { json: body },
			)
			const text = await response.text()
			if (!response.ok) {
				throw new Error(
					`${method} ${pathname} → ${response.status}: ${text.slice(0, 500)}`,
				)
			}
			return JSON.parse(text)
		},
	}
}
