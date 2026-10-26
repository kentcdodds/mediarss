import { writeFile } from 'node:fs/promises'

export function setEnvVar(key: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[key]
		return
	}
	process.env[key] = value
}

export function unsetEnvVar(key: string) {
	delete process.env[key]
}

export async function writeTextFile(path: string, contents: string) {
	await writeFile(path, contents, 'utf8')
}
