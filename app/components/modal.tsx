import type { Handle } from '@remix-run/component'
import {
	colors,
	mq,
	radius,
	shadows,
	spacing,
	transitions,
	typography,
} from '#app/styles/tokens.ts'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

type ModalProps = {
	/**
	 * The modal title - required for accessibility.
	 * This is used as the accessible name via aria-labelledby.
	 */
	title: string

	/**
	 * Optional subtitle/description shown below the title.
	 */
	subtitle?: string

	/**
	 * Optional smaller description text shown below the subtitle.
	 */
	description?: string

	/**
	 * Optional image URL to show in the header (top left corner).
	 */
	headerImage?: string

	/**
	 * The size of the modal. Affects max-width.
	 * - sm: 400px (confirmations, simple prompts)
	 * - md: 480px (forms, details)
	 * - lg: 600px (complex forms, file pickers)
	 * - xl: 800px (large content, tables)
	 * @default 'md'
	 */
	size?: ModalSize

	/**
	 * Called when the modal should close (via escape, backdrop click, or close button).
	 */
	onClose: () => void

	/**
	 * Whether to show a border below the header section.
	 * @default true
	 */
	showHeaderBorder?: boolean

	/**
	 * Content to render in the modal body.
	 */
	children: JSX.Element | JSX.Element[]

	/**
	 * Optional footer content (e.g., action buttons).
	 * If provided, renders in a sticky footer with proper spacing.
	 */
	footer?: JSX.Element | JSX.Element[]
}

const sizeMap: Record<ModalSize, string> = {
	sm: '400px',
	md: '480px',
	lg: '600px',
	xl: '800px',
}

/**
 * A reusable, accessible modal component.
 *
 * Features:
 * - Accessible: uses proper ARIA attributes, focus management
 * - Keyboard support: Escape to close, Tab trapped within modal
 * - Click outside to close
 * - Responsive: full-screen on mobile
 * - Customizable size
 *
 * @example Basic usage
 * ```tsx
 * {showModal && (
 *   <Modal
 *     title="Confirm Action"
 *     subtitle="Are you sure you want to proceed?"
 *     onClose={() => setShowModal(false)}
 *     footer={
 *       <ModalFooter>
 *         <ModalButton variant="secondary" onClick={() => setShowModal(false)}>
 *           Cancel
 *         </ModalButton>
 *         <ModalButton variant="primary" onClick={handleConfirm}>
 *           Confirm
 *         </ModalButton>
 *       </ModalFooter>
 *     }
 *   >
 *     <p>This action cannot be undone.</p>
 *   </Modal>
 * )}
 * ```
 */
export function Modal(this: Handle, _setupProps: ModalProps) {
	// Store reference to the modal container for focus management
	let modalRef: HTMLElement | null = null
	let previouslyFocusedElement: Element | null = null

	// Generate unique IDs for accessibility
	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`
	const subtitleId = `modal-subtitle-${Math.random().toString(36).slice(2, 9)}`

	return (renderProps: ModalProps) => {
		// Focus trap: keep focus within the modal
		// Defined inside render function to always use the latest onClose callback
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault()
				renderProps.onClose()
				return
			}

			if (e.key === 'Tab' && modalRef) {
				const focusableElements = modalRef.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				)
				const firstElement = focusableElements[0]
				const lastElement = focusableElements[focusableElements.length - 1]

				if (!firstElement || !lastElement) return

				if (e.shiftKey) {
					// Shift+Tab: if focus is on first element, wrap to last
					if (document.activeElement === firstElement) {
						e.preventDefault()
						lastElement.focus()
					}
				} else {
					// Tab: if focus is on last element, wrap to first
					if (document.activeElement === lastElement) {
						e.preventDefault()
						firstElement.focus()
					}
				}
			}
		}

		// Handle backdrop click
		const handleBackdropClick = (e: MouseEvent) => {
			if (e.target === e.currentTarget) {
				renderProps.onClose()
			}
		}
		const {
			title,
			subtitle,
			description,
			headerImage,
			size = 'md',
			onClose,
			showHeaderBorder = true,
			children,
			footer,
		} = renderProps

		const maxWidth = sizeMap[size]
		const describedBy = subtitle ? subtitleId : undefined

		return (
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={describedBy}
				tabIndex={-1}
				css={{
					position: 'fixed',
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					backgroundColor: 'rgba(0, 0, 0, 0.5)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					zIndex: 1000,
					padding: spacing.lg,
					outline: 'none',
					[mq.mobile]: {
						padding: 0,
					},
				}}
				on={{
					click: handleBackdropClick,
					keydown: handleKeyDown,
				}}
				connect={(node: HTMLDivElement, signal) => {
					modalRef = node

					// Store currently focused element to restore later
					previouslyFocusedElement = document.activeElement

					// Focus the close button (or first focusable element)
					const closeButton =
						node.querySelector<HTMLElement>('[data-modal-close]')
					if (closeButton) {
						// Use requestAnimationFrame to ensure DOM is ready
						requestAnimationFrame(() => {
							closeButton.focus()
						})
					}

					// Prevent body scroll while modal is open
					const originalOverflow = document.body.style.overflow
					document.body.style.overflow = 'hidden'

					// Cleanup on unmount
					signal.addEventListener('abort', () => {
						document.body.style.overflow = originalOverflow
						// Restore focus to previously focused element
						if (
							previouslyFocusedElement instanceof HTMLElement &&
							previouslyFocusedElement.focus
						) {
							previouslyFocusedElement.focus()
						}
					})
				}}
			>
				<div
					css={{
						position: 'relative',
						backgroundColor: colors.surface,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						maxWidth,
						width: '100%',
						minHeight: '400px',
						maxHeight: '85vh',
						display: 'flex',
						flexDirection: 'column',
						boxShadow: shadows.lg,
						[mq.mobile]: {
							maxWidth: 'none',
							minHeight: 'none',
							maxHeight: 'none',
							height: '100%',
							borderRadius: 0,
							border: 'none',
						},
					}}
				>
					{/* Header */}
					<div
						css={{
							padding: spacing.lg,
							paddingBottom: showHeaderBorder ? spacing.md : spacing.sm,
							borderBottom: showHeaderBorder
								? `1px solid ${colors.border}`
								: 'none',
							flexShrink: 0,
							display: 'flex',
							gap: spacing.md,
						}}
					>
						{/* Close button */}
						<button
							type="button"
							data-modal-close
							aria-label="Close modal"
							css={{
								position: 'absolute',
								top: spacing.sm,
								right: spacing.sm,
								width: '32px',
								height: '32px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								backgroundColor: colors.background,
								border: `1px solid ${colors.border}`,
								borderRadius: radius.md,
								cursor: 'pointer',
								color: colors.textMuted,
								fontSize: typography.fontSize.lg,
								transition: `all ${transitions.fast}`,
								'&:hover': {
									backgroundColor: colors.surface,
									color: colors.text,
								},
								'&:focus': {
									outline: `2px solid ${colors.primary}`,
									outlineOffset: '2px',
								},
							}}
							on={{ click: onClose }}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 14 14"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
								aria-hidden="true"
							>
								<path
									d="M1 1L13 13M13 1L1 13"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						</button>

						{headerImage && (
							<img
								src={headerImage}
								alt=""
								css={{
									width: '48px',
									height: '48px',
									borderRadius: radius.md,
									objectFit: 'cover',
									backgroundColor: colors.background,
									flexShrink: 0,
								}}
							/>
						)}

						<div css={{ minWidth: 0, flex: 1 }}>
							<h2
								id={titleId}
								css={{
									fontSize: typography.fontSize.base,
									fontWeight: typography.fontWeight.semibold,
									color: colors.text,
									margin: 0,
									paddingRight: spacing.xl,
									whiteSpace: 'nowrap',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
								}}
							>
								{title}
							</h2>

							{subtitle && (
								<p
									id={subtitleId}
									css={{
										fontSize: typography.fontSize.sm,
										color: colors.textMuted,
										margin: `2px 0 0 0`,
										paddingRight: spacing.xl,
									}}
								>
									{subtitle}
								</p>
							)}

							{description && (
								<p
									css={{
										fontSize: typography.fontSize.xs,
										color: colors.textMuted,
										margin: `4px 0 0 0`,
										paddingRight: spacing.xl,
									}}
								>
									{description}
								</p>
							)}
						</div>
					</div>

					{/* Body */}
					<div
						css={{
							flex: 1,
							minHeight: '250px',
							overflowY: 'auto',
							padding: spacing.lg,
							paddingTop: showHeaderBorder ? spacing.md : spacing.sm,
							paddingBottom: footer ? spacing.sm : spacing.lg,
						}}
					>
						{children}
					</div>

					{/* Footer */}
					{footer && (
						<div
							css={{
								padding: spacing.md,
								paddingTop: spacing.sm,
								borderTop: `1px solid ${colors.border}`,
								flexShrink: 0,
							}}
						>
							{footer}
						</div>
					)}
				</div>
			</div>
		)
	}
}

// ============================================================================
// Helper Components
// ============================================================================

type ModalFooterProps = {
	/**
	 * How to align the footer content.
	 * @default 'right'
	 */
	align?: 'left' | 'center' | 'right' | 'space-between'

	/**
	 * Footer content (typically buttons).
	 */
	children: JSX.Element | JSX.Element[]
}

/**
 * Container for modal footer actions with proper spacing and alignment.
 */
export function ModalFooter({ align = 'right', children }: ModalFooterProps) {
	const justifyMap = {
		left: 'flex-start',
		center: 'center',
		right: 'flex-end',
		'space-between': 'space-between',
	}

	return (
		<div
			css={{
				display: 'flex',
				gap: spacing.sm,
				justifyContent: justifyMap[align],
				flexWrap: 'wrap',
			}}
		>
			{children}
		</div>
	)
}

type ModalButtonVariant = 'primary' | 'secondary' | 'danger'

type ModalButtonProps = {
	/**
	 * The button variant.
	 * - primary: Primary action (filled, prominent)
	 * - secondary: Secondary action (outlined)
	 * - danger: Destructive action (red)
	 * @default 'secondary'
	 */
	variant?: ModalButtonVariant

	/**
	 * Whether the button is disabled.
	 */
	disabled?: boolean

	/**
	 * Click handler.
	 */
	onClick: () => void

	/**
	 * Button content.
	 */
	children: string | JSX.Element | JSX.Element[]
}

/**
 * A styled button for use within modal footers.
 */
export function ModalButton({
	variant = 'secondary',
	disabled = false,
	onClick,
	children,
}: ModalButtonProps) {
	const baseStyles = {
		padding: `${spacing.sm} ${spacing.lg}`,
		fontSize: typography.fontSize.sm,
		fontWeight: typography.fontWeight.medium,
		borderRadius: radius.md,
		cursor: disabled ? 'not-allowed' : 'pointer',
		transition: `all ${transitions.fast}`,
		border: 'none',
		'&:focus': {
			outline: `2px solid ${colors.primary}`,
			outlineOffset: '2px',
		},
	}

	const variantStyles: Record<ModalButtonVariant, Record<string, unknown>> = {
		primary: {
			color: colors.background,
			backgroundColor: disabled ? colors.border : colors.primary,
			'&:hover': disabled ? {} : { backgroundColor: colors.primaryHover },
		},
		secondary: {
			color: colors.text,
			backgroundColor: 'transparent',
			border: `1px solid ${colors.border}`,
			'&:hover': disabled ? {} : { backgroundColor: colors.background },
		},
		danger: {
			color: '#fff',
			backgroundColor: disabled ? colors.border : colors.error,
			'&:hover': disabled ? {} : { backgroundColor: colors.errorHover },
		},
	}

	return (
		<button
			type="button"
			disabled={disabled}
			css={{ ...baseStyles, ...variantStyles[variant] }}
			on={{ click: onClick }}
		>
			{children}
		</button>
	)
}

// ============================================================================
// Common Modal Content Patterns
// ============================================================================

type ModalAlertProps = {
	/**
	 * The type of alert.
	 * - warning: Orange/yellow for warnings
	 * - error: Red for errors/destructive actions
	 * - info: Blue for informational content
	 */
	type: 'warning' | 'error' | 'info'

	/**
	 * Alert content.
	 */
	children: JSX.Element | JSX.Element[] | string
}

/**
 * A styled alert box for displaying warnings, errors, or info within modals.
 */
export function ModalAlert({ type, children }: ModalAlertProps) {
	const colorMap = {
		warning: {
			bg: 'rgba(245, 158, 11, 0.1)',
			border: 'rgba(245, 158, 11, 0.3)',
			text: '#d97706',
		},
		error: {
			bg: 'rgba(239, 68, 68, 0.1)',
			border: 'rgba(239, 68, 68, 0.3)',
			text: '#ef4444',
		},
		info: {
			bg: 'rgba(59, 130, 246, 0.1)',
			border: 'rgba(59, 130, 246, 0.3)',
			text: '#3b82f6',
		},
	}

	const styles = colorMap[type]
	// Use role="alert" for errors (urgent), role="status" for info/warning (polite)
	const role = type === 'error' ? 'alert' : 'status'

	return (
		<div
			role={role}
			aria-live={type === 'error' ? 'assertive' : 'polite'}
			css={{
				backgroundColor: styles.bg,
				borderRadius: radius.md,
				padding: spacing.md,
				border: `1px solid ${styles.border}`,
			}}
		>
			<div
				css={{
					color: styles.text,
					fontSize: typography.fontSize.sm,
				}}
			>
				{children}
			</div>
		</div>
	)
}

/**
 * A divider line for separating content within modals.
 */
export function ModalDivider() {
	return (
		<hr
			css={{
				border: 'none',
				borderTop: `1px solid ${colors.border}`,
				margin: `${spacing.lg} 0`,
			}}
		/>
	)
}

type ModalSectionProps = {
	/**
	 * Optional section title.
	 */
	title?: string

	/**
	 * Section content.
	 */
	children: JSX.Element | JSX.Element[]
}

/**
 * A section within modal content, optionally with a title.
 */
export function ModalSection({ title, children }: ModalSectionProps) {
	return (
		<div
			css={{ marginBottom: spacing.lg, '&:last-child': { marginBottom: 0 } }}
		>
			{title && (
				<h3
					css={{
						fontSize: typography.fontSize.xs,
						fontWeight: typography.fontWeight.medium,
						color: colors.textMuted,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						margin: `0 0 ${spacing.sm} 0`,
					}}
				>
					{title}
				</h3>
			)}
			{children}
		</div>
	)
}

type ModalListProps = {
	/**
	 * List content (typically a series of ModalListItem components).
	 */
	children: JSX.Element | JSX.Element[]

	/**
	 * Maximum height before scrolling.
	 * @default '300px'
	 */
	maxHeight?: string
}

/**
 * A scrollable list container for modal content.
 */
export function ModalList({ children, maxHeight = '60vh' }: ModalListProps) {
	return (
		<div
			css={{
				display: 'flex',
				flexDirection: 'column',
				gap: spacing.sm,
				maxHeight,
				overflowY: 'auto',
			}}
		>
			{children}
		</div>
	)
}
