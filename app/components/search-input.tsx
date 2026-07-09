import { type Handle, css as rmxCss, on as rmxOn } from 'remix/ui'
import input from 'remix/ui/input'
import { renderProps } from '#app/components/props-component.ts'
import {
	colors,
	mq,
	radius,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'

type SearchInputProps = {
	placeholder: string
	value: string
	onInput: (value: string) => void
	onClear: () => void
}

/**
 * A simple search input with a clear button.
 * Handles only the UI - filtering logic stays in the parent component.
 */
export function SearchInput(handle: Handle<SearchInputProps>) {
	return renderProps(handle, ({ placeholder, value, onInput, onClear }) => (
		<div
			mix={[
				input.root({ size: 'lg' }),
				rmxCss({
					width: '100%',
					maxWidth: '400px',
					height: 'auto',
					minHeight: '36px',
					paddingBlock: 0,
					paddingInline: spacing.sm,
					gap: spacing.sm,
					fontFamily: typography.fontFamily,
					fontSize: typography.fontSize.sm,
					color: colors.text,
					background: colors.surface,
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					boxShadow: 'none',
					transition: `border-color ${transitions.fast}`,
					'&:focus-within': {
						borderColor: colors.primary,
						boxShadow: 'none',
					},
					[mq.mobile]: {
						maxWidth: 'none',
					},
				}),
			]}
		>
			<input
				type="text"
				placeholder={placeholder}
				value={value}
				mix={[
					input.field(),
					rmxCss({
						height: 'auto',
						fontSize: typography.fontSize.sm,
						color: colors.text,
						'&::placeholder': {
							color: colors.textMuted,
						},
					}),
					rmxOn('input', (e) => {
						onInput((e.target as HTMLInputElement).value)
					}),
				]}
			/>
			{value && (
				<button
					type="button"
					aria-label="Clear search"
					mix={[
						rmxCss({
							flexShrink: 0,
							width: '20px',
							height: '20px',
							padding: 0,
							border: 'none',
							borderRadius: '50%',
							backgroundColor: colors.border,
							color: colors.textMuted,
							cursor: 'pointer',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							transition: `all ${transitions.fast}`,
							'&:hover': {
								backgroundColor: colors.textMuted,
								color: colors.surface,
							},
						}),
						rmxOn('click', onClear),
					]}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 12 12"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						aria-hidden="true"
					>
						<path
							d="M2 2L10 10M10 2L2 10"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			)}
		</div>
	))
}
