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
] as const satisfies ReadonlyArray<string | null>
