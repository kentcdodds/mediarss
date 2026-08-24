/**
 * In-process diagnostic ring buffer plus structured logs.
 * Health reads recent events so a failed authorize/CIMD/MCP call is visible
 * without Cloudflare Access or NAS log scraping.
 */

export const diagnosticAreas = [
	'oauth.cimd',
	'oauth.authorize',
	'oauth.token',
	'mcp',
	'health.probe',
] as const

export type DiagnosticArea = (typeof diagnosticAreas)[number]

export type DiagnosticEvent = {
	at: string
	area: DiagnosticArea
	event: string
	ok: boolean
	durationMs?: number
	detail?: Record<string, unknown>
}

const MAX_EVENTS = 40
const events: Array<DiagnosticEvent> = []

export function recordDiagnostic(
	input: Omit<DiagnosticEvent, 'at'> & { at?: string },
): DiagnosticEvent {
	const recorded: DiagnosticEvent = {
		at: input.at ?? new Date().toISOString(),
		area: input.area,
		event: input.event,
		ok: input.ok,
		...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
		...(input.detail ? { detail: input.detail } : {}),
	}
	events.push(recorded)
	if (events.length > MAX_EVENTS) {
		events.splice(0, events.length - MAX_EVENTS)
	}

	const parts = [
		`[${recorded.area}]`,
		recorded.event,
		recorded.ok ? 'ok' : 'failed',
	]
	if (recorded.durationMs !== undefined) {
		parts.push(`${recorded.durationMs.toFixed(1)}ms`)
	}
	if (recorded.detail) {
		parts.push(JSON.stringify(recorded.detail))
	}
	console.log(parts.join(' '))
	return recorded
}

export function getRecentDiagnostics(): Array<DiagnosticEvent> {
	return [...events]
}

export function clearDiagnostics(): void {
	events.length = 0
}
