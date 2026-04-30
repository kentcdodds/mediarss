import { css as rmxCss } from 'remix/ui'
import { colors, radius, spacing, typography } from '#app/styles/tokens.ts'

type DailyActivityPoint = {
	day: string
	mediaRequests: number
}

export function AnalyticsDailyActivityChart() {
	return ({ daily }: { daily: Array<DailyActivityPoint> }) => {
		const visibleDaily = daily.slice(-14)
		const maxDailyRequests = Math.max(
			1,
			...visibleDaily.map((point) => point.mediaRequests),
		)

		return (
			<div>
				<h4
					mix={[
						rmxCss({
							fontSize: typography.fontSize.sm,
							fontWeight: typography.fontWeight.semibold,
							margin: `0 0 ${spacing.sm} 0`,
							color: colors.text,
						}),
					]}
				>
					Daily Activity
				</h4>
				{daily.length === 0 ? (
					<p
						mix={[
							rmxCss({
								margin: 0,
								fontSize: typography.fontSize.sm,
								color: colors.textMuted,
							}),
						]}
					>
						No daily activity yet.
					</p>
				) : (
					<div
						mix={[
							rmxCss({
								display: 'flex',
								flexDirection: 'column',
								gap: spacing.xs,
							}),
						]}
					>
						{visibleDaily.map((point) => (
							<div
								key={point.day}
								mix={[
									rmxCss({
										display: 'grid',
										gridTemplateColumns: '68px 1fr 52px',
										alignItems: 'center',
										gap: spacing.sm,
									}),
								]}
							>
								<span
									mix={[
										rmxCss({
											fontSize: typography.fontSize.xs,
											color: colors.textMuted,
											fontFamily: 'monospace',
										}),
									]}
								>
									{point.day.slice(5)}
								</span>
								<div
									mix={[
										rmxCss({
											height: '8px',
											borderRadius: radius.sm,
											backgroundColor: colors.background,
											overflow: 'hidden',
										}),
									]}
								>
									<div
										mix={[
											rmxCss({
												height: '100%',
												width: `${Math.max(2, (point.mediaRequests / maxDailyRequests) * 100)}%`,
												backgroundColor: colors.primary,
											}),
										]}
									/>
								</div>
								<span
									mix={[
										rmxCss({
											fontSize: typography.fontSize.xs,
											color: colors.textMuted,
											textAlign: 'right',
										}),
									]}
								>
									{point.mediaRequests}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		)
	}
}
