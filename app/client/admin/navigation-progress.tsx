import { addEventListeners, css as rmxCss, type Handle } from 'remix/ui'
import { colors } from '#app/styles/tokens.ts'
import { routerEvents } from './router.tsx'

// Spin-delay semantics (https://npm.im/spin-delay): the bar only appears if a
// navigation is still pending after `showDelayMs`, and once shown it stays
// visible for at least `minShowDurationMs` so fast completions never flash.
const showDelayMs = 150
const minShowDurationMs = 200
const completePauseMs = 80
const trickleIntervalMs = 200
const trickleIncrement = 4
const maxTrickleProgress = 90
const fadeDurationMs = 200
const initialProgress = 8

export function NavigationProgress(handle: Handle) {
	// Boolean, not a counter: navigations are latest-wins and a superseded
	// (aborted) navigation never dispatches its own `navigationend`, so the
	// winning navigation's end event must clear the pending state outright.
	let navigationPending = false
	let visible = false
	let opacity = 0
	let progress = 0
	let visibleSince = 0

	let showTimeout: ReturnType<typeof setTimeout> | null = null
	let trickleInterval: ReturnType<typeof setInterval> | null = null
	let completeTimeout: ReturnType<typeof setTimeout> | null = null
	let fadeTimeout: ReturnType<typeof setTimeout> | null = null
	let resetTimeout: ReturnType<typeof setTimeout> | null = null

	const update = () => {
		void handle.update()
	}

	const clearShowTimeout = () => {
		if (showTimeout === null) return
		clearTimeout(showTimeout)
		showTimeout = null
	}

	const clearTrickleInterval = () => {
		if (trickleInterval === null) return
		clearInterval(trickleInterval)
		trickleInterval = null
	}

	const clearCompletionTimers = () => {
		if (completeTimeout !== null) {
			clearTimeout(completeTimeout)
			completeTimeout = null
		}
		if (fadeTimeout !== null) {
			clearTimeout(fadeTimeout)
			fadeTimeout = null
		}
		if (resetTimeout !== null) {
			clearTimeout(resetTimeout)
			resetTimeout = null
		}
	}

	const clearAllTimers = () => {
		clearShowTimeout()
		clearTrickleInterval()
		clearCompletionTimers()
	}

	const startTrickle = () => {
		clearTrickleInterval()
		trickleInterval = setInterval(() => {
			if (!navigationPending || !visible) return
			progress = Math.min(maxTrickleProgress, progress + trickleIncrement)
			update()
		}, trickleIntervalMs)
	}

	const show = () => {
		showTimeout = null
		if (!navigationPending) return
		visible = true
		opacity = 1
		progress = initialProgress
		visibleSince = Date.now()
		startTrickle()
		update()
	}

	const resetHidden = () => {
		visible = false
		opacity = 0
		progress = 0
	}

	const startNavigation = () => {
		navigationPending = true
		clearCompletionTimers()

		if (visible) {
			opacity = 1
			if (progress >= 100) progress = initialProgress
			startTrickle()
			update()
			return
		}

		clearShowTimeout()
		showTimeout = setTimeout(show, showDelayMs)
	}

	const endNavigation = () => {
		if (!navigationPending) return
		navigationPending = false
		clearShowTimeout()
		clearTrickleInterval()

		if (!visible) {
			resetHidden()
			return
		}

		const remainingVisibleMs = Math.max(
			0,
			minShowDurationMs - (Date.now() - visibleSince),
		)
		completeTimeout = setTimeout(() => {
			progress = 100
			update()

			fadeTimeout = setTimeout(() => {
				opacity = 0
				update()

				resetTimeout = setTimeout(() => {
					resetHidden()
					update()
				}, fadeDurationMs)
			}, completePauseMs)
		}, remainingVisibleMs)
	}

	addEventListeners(routerEvents, handle.signal, {
		navigationstart: startNavigation,
		navigationend: endNavigation,
	})

	handle.signal.addEventListener('abort', clearAllTimers, { once: true })

	return () => (
		<div
			aria-hidden="true"
			mix={[
				rmxCss({
					position: 'fixed',
					top: 0,
					left: 0,
					right: 0,
					height: '3px',
					zIndex: 9999,
					pointerEvents: 'none',
					display: visible ? 'block' : 'none',
				}),
			]}
		>
			<div
				mix={[
					rmxCss({
						height: '100%',
						width: `${progress}%`,
						backgroundColor: colors.primary,
						opacity,
						transition: `width ${trickleIntervalMs}ms ease-out, opacity ${fadeDurationMs}ms ease-out`,
					}),
				]}
			/>
		</div>
	)
}
