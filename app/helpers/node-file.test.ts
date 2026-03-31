import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { getFileResponse } from './node-file.ts'

const placeholderPngPath = path.resolve(
	import.meta.dirname,
	'../assets/podcast-art-placeholder.png',
)

test('getFileResponse returns 304 when If-None-Match matches (default)', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'node-file-'))
	try {
		const fp = path.join(dir, 'x.png')
		await writeFile(fp, await readFile(placeholderPngPath))
		const url = 'http://example.test/x.png'
		const r1 = await getFileResponse(fp, new Request(url), {
			contentType: 'image/png',
		})
		expect(r1?.status).toBe(200)
		const etag = r1?.headers.get('etag')
		expect(etag).toBeTruthy()
		const r2 = await getFileResponse(
			fp,
			new Request(url, { headers: { 'if-none-match': etag! } }),
			{ contentType: 'image/png' },
		)
		expect(r2?.status).toBe(304)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('getFileResponse with conditionalResponses false skips 304 for matching If-None-Match', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'node-file-'))
	try {
		const fp = path.join(dir, 'x.png')
		const bytes = await readFile(placeholderPngPath)
		await writeFile(fp, bytes)
		const url = 'http://example.test/x.png'
		const r1 = await getFileResponse(fp, new Request(url), {
			contentType: 'image/png',
			conditionalResponses: false,
		})
		expect(r1?.status).toBe(200)
		expect(r1?.headers.get('etag')).toBeNull()
		const inm = 'W/"bogus"'
		const r2 = await getFileResponse(
			fp,
			new Request(url, { headers: { 'if-none-match': inm } }),
			{
				contentType: 'image/png',
				conditionalResponses: false,
			},
		)
		expect(r2?.status).toBe(200)
		expect(new Uint8Array(await r2!.arrayBuffer()).byteLength).toBe(
			bytes.length,
		)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})
