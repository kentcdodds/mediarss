type CompactCrossHeaderPrecedenceCase = {
	headers: {
		'X-Forwarded-For': string
		Forwarded: string
		'X-Real-IP': string
	}
	canonicalIp: string
}

export const compactCrossHeaderPrecedenceCases = [
	{
		headers: {
			'X-Forwarded-For': 'unknown, 203.0.113.121',
			Forwarded: 'for=198.51.100.131;proto=https',
			'X-Real-IP': '198.51.100.141',
		},
		canonicalIp: '203.0.113.121',
	},
	{
		headers: {
			'X-Forwarded-For': 'unknown, nonsense',
			Forwarded: 'for=198.51.100.132;proto=https',
			'X-Real-IP': '198.51.100.142',
		},
		canonicalIp: '198.51.100.132',
	},
	{
		headers: {
			'X-Forwarded-For': 'unknown, nonsense',
			Forwarded: 'for=unknown;proto=https',
			'X-Real-IP': '"198.51.100.143:8443"',
		},
		canonicalIp: '198.51.100.143',
	},
] as const satisfies ReadonlyArray<CompactCrossHeaderPrecedenceCase>
