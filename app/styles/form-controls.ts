import { css } from 'remix/component'

const controlFocusShadow =
	'0 2px 3px -1px rgba(0, 0, 0, 0.04), 0 3px 4px -1.5px rgba(0, 0, 0, 0.04), 0 4px 5px -2px rgba(0, 0, 0, 0.04), 0 0 0 1px light-dark(#3573F6, #6eaaff), 0 0 0 4px light-dark(rgba(53, 115, 246, 0.1), rgba(110, 170, 255, 0.18)), 0 6px 32px 4px light-dark(rgba(53, 115, 246, 0.08), rgba(110, 170, 255, 0.14)), inset 0 0 8px 1px light-dark(rgba(53, 115, 246, 0.05), rgba(110, 170, 255, 0.1))'

const checkIconMask =
	"url(\"data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.75 5.76562L5.10156 8.25L9.23438 1.75' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"

export type CheckboxState = 'checked' | 'mixed' | 'unchecked'

export const checkboxAriaChecked = {
	checked: 'true',
	mixed: 'mixed',
	unchecked: 'false',
} as const satisfies Record<CheckboxState, string>

/**
 * Large checkbox styles for a native `<input type="checkbox">`. Pair with
 * `aria-checked`/`data-state` from {@link checkboxAriaChecked} when the
 * checkbox can be indeterminate.
 */
export const checkboxStyles = css({
	'--rmx-checkbox-size': '20px',
	'--rmx-checkbox-radius': '5px',
	'--rmx-checkbox-active-radius': '6px',
	'--rmx-checkbox-check-size': '15px',
	'--rmx-checkbox-check-y': '1.25px',
	'--rmx-checkbox-mixed-width': '9px',
	'--rmx-checkbox-mixed-height': '2.25px',
	appearance: 'none',
	WebkitAppearance: 'none',
	margin: 0,
	boxSizing: 'border-box',
	position: 'relative',
	display: 'inline-grid',
	placeItems: 'center',
	width: 'var(--rmx-checkbox-size)',
	height: 'var(--rmx-checkbox-size)',
	minWidth: 'var(--rmx-checkbox-size)',
	minHeight: 'var(--rmx-checkbox-size)',
	padding: 0,
	border: 0,
	borderRadius: 'var(--rmx-checkbox-radius)',
	background: 'light-dark(#FFFFFF, #1a1a1a)',
	boxShadow:
		'0 2px 2px -1px rgba(0, 0, 0, 0.05), 0 3px 4px -1.5px rgba(0, 0, 0, 0.05), 0 4px 8px -2px rgba(0, 0, 0, 0.05), 0 5px 16px -2.5px rgba(0, 0, 0, 0.05), 0 0 0 1px light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.2))',
	color: 'light-dark(#FFFFFF, #151515)',
	verticalAlign: 'middle',
	flex: 'none',
	'&::before': {
		content: '""',
		position: 'absolute',
		opacity: 0,
		pointerEvents: 'none',
	},
	'&:disabled, &[aria-disabled="true"]': {
		opacity: 0.55,
	},
	'&:checked, &[aria-checked="true"], &[data-state="checked"], &:indeterminate, &[indeterminate], &[aria-checked="mixed"], &[data-state="mixed"]':
		{
			background:
				'linear-gradient(180deg, rgba(0, 0, 0, 0) 24.52%, light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.14)) 100%), light-dark(#3573F6, #6eaaff)',
			backgroundBlendMode: 'overlay, normal',
			borderRadius: 'var(--rmx-checkbox-active-radius)',
			boxShadow:
				'0 1px 1px -0.5px rgba(9, 68, 190, 0.12), 0 2px 2px -1px rgba(9, 68, 190, 0.12), 0 4px 4px -2px rgba(9, 68, 190, 0.12), 0 8px 8px -4px rgba(9, 68, 190, 0.12), 0 2px 8px rgba(53, 115, 246, 0.4), inset 0 0 3px 1px rgba(0, 0, 0, 0.1)',
		},
	'&:checked::before, &[aria-checked="true"]::before, &[data-state="checked"]::before':
		{
			opacity: 1,
			left: '50%',
			top: '50%',
			width: 'var(--rmx-checkbox-check-size)',
			height: 'var(--rmx-checkbox-check-size)',
			background: 'currentColor',
			mask: `${checkIconMask} center / contain no-repeat`,
			WebkitMask: `${checkIconMask} center / contain no-repeat`,
			transform: 'translate(-50%, calc(-50% + var(--rmx-checkbox-check-y)))',
		},
	'&:indeterminate::before, &[indeterminate]::before, &[aria-checked="mixed"]::before, &[data-state="mixed"]::before':
		{
			opacity: 1,
			left: '50%',
			top: '50%',
			width: 'var(--rmx-checkbox-mixed-width)',
			height: 'var(--rmx-checkbox-mixed-height)',
			border: 0,
			borderRadius: '999px',
			background: 'currentColor',
			filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4))',
			transform: 'translate(-50%, -50%)',
		},
	'&:active:not(:disabled):not([aria-disabled="true"])': {
		boxShadow:
			'0 1px 1px -0.5px rgba(0, 0, 0, 0.06), 0 0 0 1px light-dark(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.24)), inset 0 1px 2px rgba(0, 0, 0, 0.08)',
	},
	'&:checked:active:not(:disabled):not([aria-disabled="true"]), &[aria-checked="true"]:active:not(:disabled):not([aria-disabled="true"]), &[data-state="checked"]:active:not(:disabled):not([aria-disabled="true"]), &:indeterminate:active:not(:disabled):not([aria-disabled="true"]), &[indeterminate]:active:not(:disabled):not([aria-disabled="true"]), &[aria-checked="mixed"]:active:not(:disabled):not([aria-disabled="true"]), &[data-state="mixed"]:active:not(:disabled):not([aria-disabled="true"])':
		{
			boxShadow:
				'0 1px 1px -0.5px rgba(9, 68, 190, 0.1), 0 2px 2px -1px rgba(9, 68, 190, 0.1), 0 4px 4px -2px rgba(9, 68, 190, 0.1), 0 6px 8px -4px rgba(9, 68, 190, 0.1), 0 2px 6px rgba(53, 115, 246, 0.32), inset 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 0 3px 1px rgba(0, 0, 0, 0.12)',
		},
	'&:focus-visible': {
		outline: 0,
		boxShadow: controlFocusShadow,
	},
})

/**
 * Large switch styles for a native `<input type="checkbox" role="switch">`.
 */
export const toggleSwitchStyles = css({
	'--rmx-toggle-width': '36px',
	'--rmx-toggle-height': '22px',
	'--rmx-toggle-thumb-width': '22px',
	'--rmx-toggle-thumb-height': '18px',
	'--rmx-toggle-thumb-inset': '2px',
	'--rmx-toggle-thumb-translate-x':
		'calc(var(--rmx-toggle-width) - var(--rmx-toggle-thumb-width) - (var(--rmx-toggle-thumb-inset) * 2))',
	appearance: 'none',
	WebkitAppearance: 'none',
	margin: 0,
	boxSizing: 'border-box',
	position: 'relative',
	display: 'inline-block',
	width: 'var(--rmx-toggle-width)',
	height: 'var(--rmx-toggle-height)',
	minWidth: 'var(--rmx-toggle-width)',
	minHeight: 'var(--rmx-toggle-height)',
	padding: 0,
	border: 0,
	borderRadius: '9999px',
	background:
		'linear-gradient(180deg, light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08)) 0%, rgba(0, 0, 0, 0) 100%), light-dark(#EBEBEB, #2c2c2c)',
	boxShadow:
		'inset 0 0 4px 1px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(0, 0, 0, 0.02), inset 0 2px 2px rgba(0, 0, 0, 0.02)',
	verticalAlign: 'middle',
	flex: 'none',
	'&::before': {
		content: '""',
		position: 'absolute',
		left: 'var(--rmx-toggle-thumb-inset)',
		top: 'calc((var(--rmx-toggle-height) - var(--rmx-toggle-thumb-height)) / 2)',
		width: 'var(--rmx-toggle-thumb-width)',
		height: 'var(--rmx-toggle-thumb-height)',
		borderRadius: '99px',
		background:
			'linear-gradient(180deg, rgba(0, 0, 0, 0) 33%, light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.08)) 100%), light-dark(#FFFFFF, #1a1a1a)',
		boxShadow:
			'0 0 0 0.5px light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.12)), 0 1px 1px -0.5px rgba(0, 0, 0, 0.12), 0 2px 2px -1px rgba(0, 0, 0, 0.12), 0 4px 4px -2px rgba(0, 0, 0, 0.12), inset 0 0 2px 1px light-dark(#FFFFFF, rgba(255, 255, 255, 0.08))',
		transform: 'translateX(0)',
		transition:
			'transform 160ms ease, background 160ms ease, box-shadow 160ms ease',
		pointerEvents: 'none',
	},
	'&:disabled, &[aria-disabled="true"]': {
		opacity: 0.55,
	},
	'&:checked, &[aria-checked="true"], &[data-state="checked"]': {
		background:
			'linear-gradient(180deg, light-dark(#70C754, #8ee572) 0%, light-dark(#70C754, #8ee572) 100%)',
		boxShadow:
			'0 1px 0 rgba(255, 255, 255, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.4), 0 -4px 8px 2px light-dark(#FFFFFF, rgba(255, 255, 255, 0.18)), 0 4px 8px 2px rgba(0, 0, 0, 0.05), 0 0 12px 1px rgba(112, 199, 84, 0.25), inset 0 0 4px 1px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(0, 0, 0, 0.1), inset 0 2px 2px rgba(0, 0, 0, 0.1)',
	},
	'&:checked::before, &[aria-checked="true"]::before, &[data-state="checked"]::before':
		{
			background:
				'linear-gradient(180deg, rgba(112, 199, 84, 0) 25%, rgba(112, 199, 84, 0.25) 100%), light-dark(#FFFFFF, #f5fff0)',
			boxShadow:
				'0 1px 2px -0.5px rgba(66, 134, 44, 0.6), 0 2px 4px -1px rgba(66, 134, 44, 0.6), 0 4px 6px -2px rgba(66, 134, 44, 0.6), 0 0 0 0.5px light-dark(rgba(0, 0, 0, 0.28), rgba(255, 255, 255, 0.28)), inset 0 0 2px 1px light-dark(#FFFFFF, rgba(255, 255, 255, 0.5))',
			transform: 'translateX(var(--rmx-toggle-thumb-translate-x))',
		},
	'&:focus-visible': {
		outline: 0,
		boxShadow: controlFocusShadow,
	},
	'@media (prefers-reduced-motion: reduce)': {
		'&::before': {
			transition: 'none',
		},
	},
})

const textFieldPlaceholder = {
	color: 'light-dark(#B0B0B0, #777777)',
	opacity: 1,
}

/**
 * Large text-field frame that wraps an inner `<input>` styled with
 * {@link textFieldInputStyles} (plus optional icons/buttons).
 */
export const textFieldRootStyles = css({
	'--rmx-input-height': '36px',
	'--rmx-input-padding-block': '8px',
	'--rmx-input-padding-inline': '14px',
	'--rmx-input-root-padding-inline': '10px',
	'--rmx-input-gap': '8px',
	'--rmx-input-icon-size': '18px',
	'--rmx-input-icon-color': 'light-dark(#707070, #b3b3b3)',
	appearance: 'none',
	margin: 0,
	boxSizing: 'border-box',
	display: 'flex',
	alignItems: 'center',
	gap: 'var(--rmx-input-gap)',
	width: '100%',
	minWidth: 0,
	height: 'var(--rmx-input-height)',
	paddingBlock: 'var(--rmx-input-padding-block)',
	paddingInline: 'var(--rmx-input-root-padding-inline)',
	border: 0,
	borderRadius: '8px',
	background: 'light-dark(#FFFFFF, #1a1a1a)',
	boxShadow:
		'0 2px 3px -1px rgba(0, 0, 0, 0.04), 0 3px 4px -1.5px rgba(0, 0, 0, 0.04), 0 4px 5px -2px rgba(0, 0, 0, 0.04), 0 0 0 1px light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.2))',
	color: 'light-dark(#101010, #ececec)',
	fontFamily: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
	fontStyle: 'normal',
	fontWeight: 400,
	fontSize: '13px',
	lineHeight: '20px',
	fontFeatureSettings: '"ss01" on, "cv01" on',
	letterSpacing: 0,
	textShadow: '0 1px 0 light-dark(#FFFFFF, rgb(0 0 0 / 0.35))',
	'&::placeholder': textFieldPlaceholder,
	'&:disabled, &[aria-disabled="true"]': {
		opacity: 0.55,
	},
	'&:focus-within': {
		boxShadow: controlFocusShadow,
	},
	'&:has(input:disabled), &:has(input[aria-disabled="true"])': {
		opacity: 0.55,
	},
	'& > svg': {
		flex: 'none',
		width: 'var(--rmx-input-icon-size)',
		height: 'var(--rmx-input-icon-size)',
		color: 'var(--rmx-input-icon-color)',
		pointerEvents: 'none',
	},
	'& > button': {
		flex: 'none',
	},
})

/** Borderless inner `<input>` for {@link textFieldRootStyles}. */
export const textFieldInputStyles = css({
	appearance: 'none',
	margin: 0,
	boxSizing: 'border-box',
	flex: '1 1 auto',
	minWidth: 0,
	width: '100%',
	height: '20px',
	padding: 0,
	border: 0,
	outline: 0,
	background: 'transparent',
	boxShadow: 'none',
	color: 'light-dark(#101010, #ececec)',
	font: 'inherit',
	fontFeatureSettings: 'inherit',
	letterSpacing: 'inherit',
	textShadow: 'inherit',
	'&::placeholder': textFieldPlaceholder,
	'&:disabled, &[aria-disabled="true"]': {
		opacity: 1,
	},
})
