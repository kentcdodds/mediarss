const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365

type ParseAnalyticsWindowDaysOptions = {
	defaultDays?: number
	maxDays?: number
	queryParam?: string
}

function normalizePositiveSafeInt(value: number, fallback: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/**
 * Parse analytics window days from query params.
 * Accepts only positive integer values; invalid values fall back to default.
 */
export function parseAnalyticsWindowDays(
	request: Request,
	options: ParseAnalyticsWindowDaysOptions = {},
): number {
	const queryParam = options.queryParam ?? 'days'
	const maxDays = normalizePositiveSafeInt(
		options.maxDays ?? MAX_WINDOW_DAYS,
		MAX_WINDOW_DAYS,
	)
	const defaultDays = Math.min(
		normalizePositiveSafeInt(
			options.defaultDays ?? DEFAULT_WINDOW_DAYS,
			DEFAULT_WINDOW_DAYS,
		),
		maxDays,
	)

	const { searchParams } = new URL(request.url)
	const rawValue = searchParams.get(queryParam)

	if (!rawValue) {
		return defaultDays
	}

	if (!/^\d+$/.test(rawValue)) {
		return defaultDays
	}

	let parsedBigInt: bigint
	try {
		parsedBigInt = BigInt(rawValue)
	} catch {
		return defaultDays
	}

	if (parsedBigInt <= 0n) {
		return defaultDays
	}

	const maxDaysBigInt = BigInt(maxDays)
	if (parsedBigInt > maxDaysBigInt) {
		return maxDays
	}

	return Number(parsedBigInt)
}
