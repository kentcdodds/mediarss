import { css as rmxCss } from 'remix/ui'
import {
	colors,
	mq,
	radius,
	responsive,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'

export const pageStyle = rmxCss({
	fontFamily: typography.fontFamily,
	minHeight: '100vh',
	backgroundColor: colors.background,
	color: colors.text,
	display: 'flex',
	flexDirection: 'column',
})

export const headerStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	gap: spacing.md,
	padding: `${spacing.md} ${responsive.spacingHeader}`,
	borderBottom: `1px solid ${colors.border}`,
	[mq.mobile]: {
		gap: spacing.sm,
	},
})

export const mainStyle = rmxCss({
	flex: 1,
	maxWidth: '1200px',
	width: '100%',
	margin: '0 auto',
	padding: responsive.spacingPage,
	boxSizing: 'border-box',
})

export const cardStyle = rmxCss({
	backgroundColor: colors.surface,
	border: `1px solid ${colors.border}`,
	borderRadius: radius.lg,
	padding: spacing.lg,
	boxShadow: shadows.sm,
})

export const gridStyle = rmxCss({
	display: 'grid',
	gridTemplateColumns: `repeat(auto-fill, minmax(${responsive.cardMinWidth}, 1fr))`,
	gap: spacing.lg,
	[mq.mobile]: {
		gap: spacing.md,
	},
})

export const stackStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.lg,
})

export const rowStyle = rmxCss({
	display: 'flex',
	alignItems: 'center',
	gap: spacing.md,
	flexWrap: 'wrap',
})

export const labelStyle = rmxCss({
	display: 'flex',
	flexDirection: 'column',
	gap: spacing.xs,
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	color: colors.text,
})

export const inputStyle = rmxCss({
	width: '100%',
	boxSizing: 'border-box',
	border: `1px solid ${colors.border}`,
	borderRadius: radius.md,
	padding: spacing.sm,
	font: 'inherit',
	fontSize: typography.fontSize.sm,
	color: colors.text,
	backgroundColor: colors.background,
	outline: 'none',
	transition: `border-color ${transitions.fast}`,
	'&:focus': {
		borderColor: colors.primary,
	},
	'&::placeholder': {
		color: colors.textMuted,
	},
})

export const buttonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: spacing.sm,
	border: 'none',
	borderRadius: radius.md,
	padding: `${spacing.sm} ${spacing.lg}`,
	backgroundColor: colors.primary,
	color: colors.background,
	font: 'inherit',
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	textDecoration: 'none',
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.primaryHover,
	},
})

export const secondaryButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: spacing.sm,
	border: `1px solid ${colors.primary}`,
	borderRadius: radius.md,
	padding: `${spacing.sm} ${spacing.lg}`,
	backgroundColor: 'transparent',
	color: colors.primary,
	font: 'inherit',
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	textDecoration: 'none',
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.primarySoft,
	},
})

export const dangerButtonStyle = rmxCss({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	border: 'none',
	borderRadius: radius.md,
	padding: `${spacing.sm} ${spacing.lg}`,
	backgroundColor: colors.error,
	color: colors.background,
	font: 'inherit',
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.medium,
	cursor: 'pointer',
	transition: `all ${transitions.fast}`,
	'&:hover': {
		backgroundColor: colors.errorHover,
	},
})

export const mutedStyle = rmxCss({
	color: colors.textMuted,
})

export const emptyStateStyle = rmxCss({
	textAlign: 'center',
	padding: spacing['2xl'],
	backgroundColor: colors.surface,
	borderRadius: radius.lg,
	border: `1px dashed ${colors.border}`,
})
