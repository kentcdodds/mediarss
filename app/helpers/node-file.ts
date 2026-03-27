import fs from 'node:fs'
import { basename } from 'node:path'
import { createFileResponse } from 'remix/response/file'

export async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.promises.access(path, fs.constants.F_OK)
		return true
	} catch {
		return false
	}
}

export async function createLazyFile(
	path: string,
	type = 'application/octet-stream',
): Promise<File | null> {
	try {
		const stats = await fs.promises.stat(path)
		const blob = await fs.openAsBlob(path, { type })
		return new File([blob], basename(path), {
			type,
			lastModified: stats.mtimeMs,
		})
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null
		}
		throw error
	}
}

export async function getFileResponse(
	path: string,
	request: Request,
	options: {
		cacheControl?: string
		contentType?: string
	} = {},
): Promise<Response | null> {
	const file = await createLazyFile(
		path,
		options.contentType ?? 'application/octet-stream',
	)
	if (!file) {
		return null
	}
	return createFileResponse(file, request, {
		cacheControl: options.cacheControl,
	})
}

export async function writeFile(
	path: string,
	data: string | ArrayBuffer | ArrayBufferView | Blob,
): Promise<void> {
	if (typeof data === 'string') {
		await fs.promises.writeFile(path, data)
		return
	}

	if (data instanceof Blob) {
		const buffer = Buffer.from(await data.arrayBuffer())
		await fs.promises.writeFile(path, buffer)
		return
	}

	if (data instanceof ArrayBuffer) {
		await fs.promises.writeFile(path, new Uint8Array(data))
		return
	}

	await fs.promises.writeFile(path, data)
}
