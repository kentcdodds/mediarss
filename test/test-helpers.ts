import { mkdir, rm, writeFile } from 'node:fs/promises'

export function setEnv(key: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[key]
		return
	}
	process.env[key] = value
}

export const setEnvVar = setEnv

export const deleteEnvVar = unsetEnvVar

export function unsetEnvVar(key: string) {
	delete process.env[key]
}

export async function writeTextFile(path: string, contents: string) {
	await writeFile(path, contents, 'utf8')
}

export async function ensureDir(path: string) {
	await mkdir(path, { recursive: true })
}

export async function removeDir(path: string) {
	await rm(path, { recursive: true, force: true })
}
