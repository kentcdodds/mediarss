export function replaceUrlInPlace(href: string) {
	const state = window.navigation?.currentEntry?.getState()
	window.history.replaceState(window.history.state, '', href)
	// Preserve Remix navigation state so traversing back to this entry reloads the frame.
	if (state !== undefined) window.navigation?.updateCurrentEntry({ state })
}
