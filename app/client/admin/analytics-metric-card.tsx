import { css as rmxCss } from 'remix/ui'
import { colors, radius, spacing, typography } from '#app/styles/tokens.ts'

export function AnalyticsMetricCard() {
	return ({ label, value }: { label: string; value: string }) => (
		<div
			mix={[
				rmxCss({
					padding: spacing.sm,
					borderRadius: radius.md,
					border: `1px solid ${colors.border}`,
					backgroundColor: colors.background,
				}),
			]}
		>
			<div
				mix={[
					rmxCss({
						fontSize: typography.fontSize.xs,
						color: colors.textMuted,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						marginBottom: spacing.xs,
					}),
				]}
			>
				{label}
			</div>
			<div
				mix={[
					rmxCss({
						fontSize: typography.fontSize.base,
						fontWeight: typography.fontWeight.semibold,
						color: colors.text,
					}),
				]}
			>
				{value}
			</div>
		</div>
	)
}
