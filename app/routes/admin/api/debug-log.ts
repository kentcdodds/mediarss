import fs from 'node:fs'
import { type BuildAction } from 'remix/fetch-router'
import type routes from '#app/config/routes.ts'

type DebugLogPayload = {
	hypothesisId?: string
	location?: string
	message?: string
	data?: unknown
	timestamp?: number
}

export default {
	middleware: [],
	async handler(context) {
		if (context.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		let body: DebugLogPayload
		try {
			body = (await context.request.json()) as DebugLogPayload
		} catch {
			return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
		}

		const entry = {
			hypothesisId: body.hypothesisId ?? 'unknown',
			location: body.location ?? 'unknown',
			message: body.message ?? 'unknown',
			data: body.data ?? {},
			timestamp: body.timestamp ?? Date.now(),
		}

		fs.appendFileSync(
			'/opt/cursor/logs/debug.log',
			`${JSON.stringify(entry)}\n`,
		)
		return Response.json({ ok: true })
	},
} satisfies BuildAction<
	typeof routes.adminApiDebugLog.method,
	typeof routes.adminApiDebugLog.pattern
>
