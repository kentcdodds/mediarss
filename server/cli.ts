import closeWithGrace from 'close-with-grace'
import type { AppServer } from './node-server.ts'
import { copyToClipboard, openInBrowser } from './platform-cli.ts'

const reset = '\x1b[0m'
const brightCode = '\x1b[1m'
const dimCode = '\x1b[2m'

const ANSI_COLORS = {
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	cornflowerblue: '\x1b[94m',
	dodgerblue: '\x1b[94m',
	yellow: '\x1b[33m',
	magenta: '\x1b[35m',
	firebrick: '\x1b[31m',
	crimson: '\x1b[31m',
} as const

const colorize = (text: string, color: keyof typeof ANSI_COLORS) =>
	`${ANSI_COLORS[color]}${text}${reset}`

const bright = (text: string) => `${brightCode}${text}${reset}`
const dim = (text: string) => `${dimCode}${text}${reset}`

const showHelp = () => {
	console.log(`\n${bright('Keyboard shortcuts:')}`)
	console.log(
		`  ${colorize('o', 'cyan')} - ${colorize('Open in browser', 'green')}`,
	)
	console.log(
		`  ${colorize('u', 'cyan')} - ${colorize('Copy URL to clipboard', 'cornflowerblue')}`,
	)
	console.log(
		`  ${colorize('c', 'cyan')} - ${colorize('Clear console', 'yellow')}`,
	)
	console.log(
		`  ${colorize('h', 'cyan')} - ${colorize('Show this help', 'magenta')}`,
	)
	console.log(
		`  ${colorize('q', 'cyan')} - ${colorize('Quit server', 'firebrick')}`,
	)
}

export function setupInteractiveCli(url: string, server: AppServer) {
	console.log(`${dim('App is running on')} ${bright(url)}`)

	// Use close-with-grace for robust graceful shutdown
	// Handles SIGINT, SIGTERM, uncaught exceptions, and unhandled rejections
	const closeListeners = closeWithGrace({ delay: 500 }, async ({ err }) => {
		if (err) {
			console.error('Error during shutdown:', err)
		}
		console.log(`\n\n${colorize('Shutting down...', 'crimson')}`)
		server.stop(true) // true = close all idle connections immediately
	})

	const stdin = process.stdin
	const canUseRawMode =
		!!stdin &&
		typeof stdin.setRawMode === 'function' &&
		// On some environments stdin exists but is not a TTY
		// (e.g. when run under a non-interactive process).
		// In that case, raw mode + key handling doesn't work.
		(stdin.isTTY ?? false)

	if (!canUseRawMode) return

	showHelp()

	// Set stdin to raw mode for immediate key press detection
	stdin.setRawMode(true)
	stdin.resume()
	stdin.setEncoding('utf8')

	stdin.on('data', (key) => {
		const char = key.toString()
		// Handle Ctrl+C - trigger graceful shutdown
		if (char === '\u0003') {
			closeListeners.close()
			return
		}

		switch (char) {
			case 'o':
			case 'O': {
				console.log(`\n${colorize('Opening browser...', 'green')}`)
				openInBrowser(url)
				break
			}
			case 'u':
			case 'U': {
				console.log(
					`\n${colorize('Copying URL to clipboard...', 'dodgerblue')}`,
				)
				copyToClipboard(url)
				console.log(
					`${colorize('✓', 'green')} ${dim('URL copied:')} ${bright(url)}`,
				)
				break
			}
			case 'c':
			case 'C': {
				console.clear()
				console.log(`${dim('App is running on')} ${bright(url)}`)
				showHelp()
				break
			}
			case 'h':
			case 'H':
			case '?': {
				showHelp()
				break
			}
			case 'q':
			case 'Q': {
				closeListeners.close()
			}
		}
	})
}
