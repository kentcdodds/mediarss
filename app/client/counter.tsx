import type { Handle } from '@remix-run/component'
import { press } from '@remix-run/interaction/press'
import {
	colors,
	radius,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'

type Props = { initial?: number }

export function Counter(this: Handle, { initial }: Props) {
	let count = initial ?? 0
	return () => (
		<button
			type="button"
			css={{
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
			}}
			on={{
				[press]: () => {
					count++
					this.update()
				},
			}}
		>
			Count:{' '}
			<span css={{ fontWeight: typography.fontWeight.bold }}>{count}</span>
		</button>
	)
}
