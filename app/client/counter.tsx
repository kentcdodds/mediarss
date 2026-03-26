import {
	type Handle,
	pressEvents,
	css as rmxCss,
	on as rmxOn,
} from 'remix/component'
import {
	colors,
	radius,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'

type CounterSetup = { initial?: number }

export function Counter(handle: Handle, setup: CounterSetup = {}) {
	let count = setup.initial ?? 0
	return () => (
		<button
			type="button"
			mix={[
				rmxCss({
					padding: `${spacing.lg} ${spacing.xl}`,
					fontSize: typography.fontSize.base,
					fontWeight: typography.fontWeight.medium,
					color: colors.background,
					backgroundColor: colors.primary,
					border: 'none',
					borderRadius: radius.md,
					cursor: 'pointer',
					transition: `all ${transitions.fast}`,
					'&:hover': {
						backgroundColor: colors.primaryHover,
					},
					'&:active': {
						transform: 'scale(0.98)',
						backgroundColor: colors.primaryActive,
					},
				}),
				pressEvents(),
				rmxOn(pressEvents.press, () => {
					count++
					handle.update()
				}),
			]}
		>
			Count:{' '}
			<span mix={[rmxCss({ fontWeight: typography.fontWeight.bold })]}>
				{count}
			</span>
		</button>
	)
}
