// Color tokens
export const colors = {
	primary: 'var(--color-primary)',
	primaryHover: 'var(--color-primary-hover)',
	primaryActive: 'var(--color-primary-active)',
	background: 'var(--color-background)',
	surface: 'var(--color-surface)',
	text: 'var(--color-text)',
	textMuted: 'var(--color-text-muted)',
	border: 'var(--color-border)',
} as const

// Typography tokens
export const typography = {
	fontFamily: 'var(--font-family)',
	fontSize: {
		xs: 'var(--font-size-xs)',
		sm: 'var(--font-size-sm)',
		base: 'var(--font-size-base)',
		lg: 'var(--font-size-lg)',
		xl: 'var(--font-size-xl)',
		'2xl': 'var(--font-size-2xl)',
	} as const,
	fontWeight: {
		normal: 'var(--font-weight-normal)',
		medium: 'var(--font-weight-medium)',
		semibold: 'var(--font-weight-semibold)',
		bold: 'var(--font-weight-bold)',
	} as const,
} as const

// Spacing tokens
export const spacing = {
	xs: 'var(--spacing-xs)',
	sm: 'var(--spacing-sm)',
	md: 'var(--spacing-md)',
	lg: 'var(--spacing-lg)',
	xl: 'var(--spacing-xl)',
	'2xl': 'var(--spacing-2xl)',
} as const

// Border radius tokens
export const radius = {
	sm: 'var(--radius-sm)',
	md: 'var(--radius-md)',
	lg: 'var(--radius-lg)',
	xl: 'var(--radius-xl)',
} as const

// Shadow tokens
export const shadows = {
	sm: 'var(--shadow-sm)',
	md: 'var(--shadow-md)',
	lg: 'var(--shadow-lg)',
} as const

// Transition tokens
export const transitions = {
	fast: 'var(--transition-fast)',
	normal: 'var(--transition-normal)',
} as const
