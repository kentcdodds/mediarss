import { css as rmxCss } from 'remix/component'
import { colors, spacing } from '#app/styles/tokens.ts'

export function LoadingSpinner() {
	return () => (
		<div
			mix={[
				rmxCss({
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					padding: spacing['2xl'],
				}),
			]}
		>
			<div
				mix={[
					rmxCss({
						width: '40px',
						height: '40px',
						border: `3px solid ${colors.border}`,
						borderTopColor: colors.primary,
						borderRadius: '50%',
						animation: 'spin 1s linear infinite',
						'@keyframes spin': {
							to: { transform: 'rotate(360deg)' },
						},
					}),
				]}
			/>
		</div>
	)
}
