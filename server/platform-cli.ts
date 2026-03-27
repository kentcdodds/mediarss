import { spawn } from 'node:child_process'

function spawnAndForget(command: string, args: string[], input?: string): boolean {
	try {
		const child = spawn(command, args, {
			detached: true,
			stdio: input ? ['pipe', 'ignore', 'ignore'] : 'ignore',
		})
		if (input) {
			child.stdin?.end(input)
		}
		child.unref()
		return true
	} catch {
		return false
	}
}

export function openInBrowser(url: string): boolean {
	if (process.platform === 'darwin') {
		return spawnAndForget('open', [url])
	}
	if (process.platform === 'win32') {
		return spawnAndForget('cmd', ['/c', 'start', '', url])
	}
	return spawnAndForget('xdg-open', [url])
}

export function copyToClipboard(text: string): boolean {
	if (process.platform === 'darwin') {
		return spawnAndForget('pbcopy', [], text)
	}
	if (process.platform === 'win32') {
		return spawnAndForget('clip', [], text)
	}
	return spawnAndForget('xclip', ['-selection', 'clipboard'], text)
}
