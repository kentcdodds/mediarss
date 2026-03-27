import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ExecResult = {
	stdout: string
	stderr: string
	exitCode: number
}

export async function execCommand(
	command: string,
	args: string[],
): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			encoding: 'utf8',
		})
		return { stdout, stderr, exitCode: 0 }
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & {
			stdout?: string
			stderr?: string
			code?: number | string
		}

		return {
			stdout: failure.stdout ?? '',
			stderr: failure.stderr ?? failure.message,
			exitCode: typeof failure.code === 'number' ? failure.code : 1,
		}
	}
}
