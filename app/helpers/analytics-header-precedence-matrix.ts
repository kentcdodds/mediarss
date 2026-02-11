export const crossHeaderXForwardedForValues = [
	null,
	'unknown, 203.0.113.121',
	'unknown, nonsense',
	'"198.51.100.144"',
	'[2001:db8::99]:443',
	'\\"unknown\\", 198.51.100.147',
	'_hidden, 198.51.100.148',
	'   ,   ',
	'UNKNOWN, 198.51.100.153',
	'for=198.51.100.156;proto=https, 198.51.100.157',
	'[::FFFF:198.51.100.158]:443',
	'for=198.51.100.170;proto=https',
	'"unknown, [::ffff:198.51.100.229]:443"',
] as const satisfies ReadonlyArray<string | null>

export const crossHeaderForwardedValues = [
	null,
	'for=198.51.100.132;proto=https',
	'for=unknown;proto=https',
	'for="\\"unknown\\", 198.51.100.145";proto=https',
	'for="[2001:DB8::9a]:443";proto=https',
	'for="\\\\"unknown\\\\", 198.51.100.149";proto=https',
	'for=_hidden;proto=https,for=198.51.100.150;proto=https',
	'for="";proto=https',
	'for=UNKNOWN;proto=https,for=198.51.100.154;proto=https',
	'proto=https;by=proxy;for=198.51.100.159',
	'for="[::ffff:198.51.100.160]:443";proto=https',
	'for = unknown; for = 198.51.100.171; proto=https',
	'proto=https;for="unknown, FOR = [::ffff:198.51.100.242]:443";by=proxy',
] as const satisfies ReadonlyArray<string | null>

export const crossHeaderXRealIpValues = [
	null,
	'"198.51.100.143:8443"',
	'unknown, nonsense',
	'"unknown,198.51.100.146"',
	'[2001:db8::9b]:443',
	'\\"unknown\\", 198.51.100.151',
	'_hidden, 198.51.100.152',
	'   ,   ',
	'UNKNOWN, 198.51.100.155',
	'for=198.51.100.161, 198.51.100.162',
	'"[::FFFF:198.51.100.163]:443"',
	'for=198.51.100.172;proto=https',
	'"\\"unknown\\", [::ffff:198.51.100.236]:443"',
] as const satisfies ReadonlyArray<string | null>

export const repeatedForwardedForValues = [
	'198.51.100.181',
	'unknown',
	'_hidden',
	'"198.51.100.182"',
	'[::ffff:198.51.100.183]:443',
	'"unknown, 198.51.100.214"',
	'"\\"unknown\\", 198.51.100.215"',
	'for=198.51.100.217',
	'FOR = [::ffff:198.51.100.218]:443',
	'"unknown, for=198.51.100.220"',
	'"\\"unknown\\", FOR = [::ffff:198.51.100.221]:443"',
] as const satisfies ReadonlyArray<string>

export const repeatedForwardedForHeaderBuilders = [
	(firstValue: string, secondValue: string) =>
		`for=${firstValue};for=${secondValue};proto=https`,
	(firstValue: string, secondValue: string) =>
		`FOR = ${firstValue}; FOR = ${secondValue}; proto=https`,
	(firstValue: string, secondValue: string) =>
		`proto=https;for=${firstValue};by=proxy;for=${secondValue}`,
	(firstValue: string, secondValue: string) =>
		`host=example.com; FOR = ${firstValue}; by=proxy; FOR = ${secondValue}; proto=https`,
] as const satisfies ReadonlyArray<
	(firstValue: string, secondValue: string) => string
>

export const repeatedForwardedTripleForValues = [
	'198.51.100.211',
	'unknown',
	'_hidden',
	'"198.51.100.212"',
	'[::ffff:198.51.100.213]:443',
	'"unknown, 198.51.100.214"',
	'"\\"unknown\\", 198.51.100.215"',
	'for=198.51.100.217',
	'FOR = [::ffff:198.51.100.218]:443',
	'"unknown, for=198.51.100.220"',
	'"\\"unknown\\", FOR = [::ffff:198.51.100.221]:443"',
] as const satisfies ReadonlyArray<string>

export const repeatedForwardedTripleForHeaderBuilders = [
	(firstValue: string, secondValue: string, thirdValue: string) =>
		`for=${firstValue};for=${secondValue};for=${thirdValue};proto=https`,
	(firstValue: string, secondValue: string, thirdValue: string) =>
		`FOR = ${firstValue}; FOR = ${secondValue}; FOR = ${thirdValue}; proto=https`,
	(firstValue: string, secondValue: string, thirdValue: string) =>
		`proto=https;for=${firstValue};by=proxy;for=${secondValue};host=example.com;for=${thirdValue}`,
	(firstValue: string, secondValue: string, thirdValue: string) =>
		`host=example.com; FOR = ${firstValue}; by=proxy; FOR = ${secondValue}; proto=https; FOR = ${thirdValue}`,
] as const satisfies ReadonlyArray<
	(firstValue: string, secondValue: string, thirdValue: string) => string
>
