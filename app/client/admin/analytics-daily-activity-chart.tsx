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
					css={{
						fontSize: typography.fontSize.sm,
						fontWeight: typography.fontWeight.semibold,
						margin: `0 0 ${spacing.sm} 0`,
						color: colors.text,
					}}
				>
					Daily Activity
				</h4>
				{daily.length === 0 ? (
					<p
						css={{
							margin: 0,
							fontSize: typography.fontSize.sm,
							color: colors.textMuted,
						}}
					>
						No daily activity yet.
					</p>
				) : (
					<div
						css={{
							display: 'flex',
							flexDirection: 'column',
							gap: spacing.xs,
						}}
					>
						{visibleDaily.map((point) => (
							<div
								key={point.day}
								css={{
									display: 'grid',
									gridTemplateColumns: '68px 1fr 52px',
									alignItems: 'center',
									gap: spacing.sm,
								}}
							>
								<span
									css={{
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										fontFamily: 'monospace',
									}}
								>
									{point.day.slice(5)}
								</span>
								<div
									css={{
										height: '8px',
										borderRadius: radius.sm,
										backgroundColor: colors.background,
										overflow: 'hidden',
									}}
								>
									<div
										css={{
											height: '100%',
											width: `${Math.max(2, (point.mediaRequests / maxDailyRequests) * 100)}%`,
											backgroundColor: colors.primary,
										}}
									/>
								</div>
								<span
									css={{
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										textAlign: 'right',
									}}
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
