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
export function SearchInput({
	placeholder,
	value,
	onInput,
	onClear,
}: SearchInputProps) {
	return (
		<div
			css={{
				position: 'relative',
				width: '100%',
				maxWidth: '400px',
				[mq.mobile]: {
					maxWidth: 'none',
				},
			}}
		>
			<input
				type="text"
				placeholder={placeholder}
				value={value}
				css={{
					width: '100%',
					padding: spacing.sm,
					paddingRight: value ? '36px' : spacing.sm,
					fontSize: typography.fontSize.sm,
					color: colors.text,
					backgroundColor: colors.surface,
					border: `1px solid ${colors.border}`,
					borderRadius: radius.md,
					outline: 'none',
					transition: `border-color ${transitions.fast}`,
					'&:focus': {
						borderColor: colors.primary,
					},
					'&::placeholder': {
						color: colors.textMuted,
					},
				}}
				on={{
					input: (e: Event) => {
						onInput((e.target as HTMLInputElement).value)
					},
				}}
			/>
			{value && (
				<button
					type="button"
					aria-label="Clear search"
					css={{
						position: 'absolute',
						right: '8px',
						top: '50%',
						transform: 'translateY(-50%)',
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
					}}
					on={{
						click: onClear,
					}}
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
	)
}
