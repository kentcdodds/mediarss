import { getEnv } from '#app/config/env.ts'
import { db } from '#app/db/index.ts'
import { fetchClientMetadataLive } from '#app/oauth/client-metadata.ts'
import { getRecentDiagnostics, recordDiagnostic } from './diagnostics.ts'
import { getVersionInfo } from './version.ts'

export const DEFAULT_CIMD_PROBE_URL =
	'https://kody.codes/oauth/client-metadata.json'

export type HealthDatabaseStatus = {
	ok: boolean
	error?: string
}

export type HealthCimdProbe = {
	url: string
	ok: boolean
	error?: string
	durationMs: number
}

export type HealthSnapshot = {
	status: 'ok' | 'error'
	timestamp: string
	version: string | null
	commit: {
		sha: string
		short: string
		source: 'env' | 'git'
		message: string
		date: string
	} | null
	uptimeMs: number
	startTime: string
	node: string
	nodeEnv: string
	mcp: {
		protocol: '2026-07-28'
		legacy: 'reject'
	}
	oauth: {
		clientIdMetadataDocumentSupported: true
	}
	database: HealthDatabaseStatus
	mediaRoots: Array<string>
	diagnostics: ReturnType<typeof getRecentDiagnostics>
	probes?: {
		cimd: HealthCimdProbe
	}
}

function checkDatabase(): HealthDatabaseStatus {
	try {
		db.query('SELECT 1').get()
		return { ok: true }
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}

export const CIMD_PROBE_COOLDOWN_MS = 10_000

let cimdProbeInFlight: Promise<HealthCimdProbe> | null = null
let lastCimdProbe: { at: number; result: HealthCimdProbe } | null = null

export function resetCimdProbeState(): void {
	cimdProbeInFlight = null
	lastCimdProbe = null
}

async function runCimdProbe(url: string): Promise<HealthCimdProbe> {
	const started = performance.now()
	const lookup = await fetchClientMetadataLive(url)
	const durationMs = performance.now() - started
	const probe: HealthCimdProbe = lookup.metadata
		? { url, ok: true, durationMs }
		: { url, ok: false, error: lookup.error, durationMs }
	recordDiagnostic({
		area: 'health.probe',
		event: 'cimd',
		ok: probe.ok,
		durationMs,
		detail: {
			url,
			...(probe.error ? { error: probe.error } : {}),
		},
	})
	return probe
}

async function probeCimd(url: string): Promise<HealthCimdProbe> {
	if (cimdProbeInFlight) return cimdProbeInFlight
	if (lastCimdProbe && Date.now() - lastCimdProbe.at < CIMD_PROBE_COOLDOWN_MS) {
		return lastCimdProbe.result
	}

	cimdProbeInFlight = runCimdProbe(url)
	try {
		const result = await cimdProbeInFlight
		lastCimdProbe = { at: Date.now(), result }
		return result
	} finally {
		cimdProbeInFlight = null
	}
}

export async function getHealthSnapshot(url: URL): Promise<HealthSnapshot> {
	const [versionInfo, database] = await Promise.all([
		getVersionInfo(),
		Promise.resolve(checkDatabase()),
	])
	const commit = versionInfo.commit
		? {
				sha: versionInfo.commit.hash,
				short: versionInfo.commit.shortHash,
				source: versionInfo.commit.source,
				message: versionInfo.commit.message,
				date: versionInfo.commit.date,
			}
		: null

	const snapshot: HealthSnapshot = {
		status: database.ok ? 'ok' : 'error',
		timestamp: new Date().toISOString(),
		version: versionInfo.version,
		commit,
		uptimeMs: versionInfo.uptimeMs,
		startTime: versionInfo.startTime,
		node: process.version,
		nodeEnv: getEnv().NODE_ENV,
		mcp: {
			protocol: '2026-07-28',
			legacy: 'reject',
		},
		oauth: {
			clientIdMetadataDocumentSupported: true,
		},
		database,
		mediaRoots: getEnv().MEDIA_PATHS.map((root) => root.name),
		diagnostics: getRecentDiagnostics(),
	}

	if (url.searchParams.get('probe') === 'cimd') {
		snapshot.probes = { cimd: await probeCimd(DEFAULT_CIMD_PROBE_URL) }
		if (!snapshot.probes.cimd.ok) snapshot.status = 'error'
		snapshot.diagnostics = getRecentDiagnostics()
	}

	return snapshot
}

export async function createHealthResponse(url: URL): Promise<Response> {
	const snapshot = await getHealthSnapshot(url)
	return Response.json(snapshot, {
		status: snapshot.status === 'ok' ? 200 : 503,
	})
}
