import { beforeEach, expect, test, vi } from 'vitest'
import { type AuthInfo } from './auth.ts'

type AnyAsync = (...args: Array<unknown>) => Promise<unknown>

const { applyMock, readMock } = vi.hoisted(() => ({
	applyMock: vi.fn<AnyAsync>(),
	readMock: vi.fn<AnyAsync>(),
}))

vi.mock('./auth.ts', () => ({
	hasScope: (authInfo: AuthInfo, ...scopes: Array<string>) =>
		scopes.every((scope) => authInfo.scopes.includes(scope)),
}))

vi.mock('#app/helpers/media-metadata-edit.ts', () => ({
	EDITABLE_METADATA_FIELDS: [
		'title',
		'author',
		'description',
		'date',
		'genre',
		'trackNumber',
		'copyright',
		'narrator',
		'album',
		'albumArtist',
		'composer',
		'publisher',
		'discNumber',
		'language',
		'series',
		'seriesPosition',
		'encodedBy',
		'subtitle',
	],
	applyMediaMetadataUpdate: applyMock,
	readMediaMetadata: readMock,
}))

function authWith(scopes: string[]): AuthInfo {
	return { token: 't', clientId: 'c', scopes } as AuthInfo
}

function fakeServer() {
	const tools = new Map<string, (input: any) => Promise<any>>()
	return {
		tools,
		registerTool: ((name: string, _config: unknown, handler: any) => {
			tools.set(name, handler)
		}) as any,
	}
}

beforeEach(() => {
	applyMock.mockReset()
	readMock.mockReset()
})

test('metadata tools are gated by scope', async () => {
	const { registerMediaMetadataTools } =
		await import('./media-metadata-tools.ts')

	const readOnly = fakeServer()
	registerMediaMetadataTools(readOnly, authWith(['mcp:read']))
	expect([...readOnly.tools.keys()]).toEqual(['get_media_metadata'])

	const writeOnly = fakeServer()
	registerMediaMetadataTools(writeOnly, authWith(['mcp:write']))
	expect([...writeOnly.tools.keys()]).toEqual(['update_media_metadata'])

	const both = fakeServer()
	registerMediaMetadataTools(both, authWith(['mcp:read', 'mcp:write']))
	expect([...both.tools.keys()].sort()).toEqual([
		'get_media_metadata',
		'update_media_metadata',
	])

	const none = fakeServer()
	registerMediaMetadataTools(none, authWith([]))
	expect(none.tools.size).toBe(0)
})

test('update_media_metadata forwards only editable fields to the shared editor', async () => {
	const { updateMediaMetadataTool } = await import('./media-metadata-tools.ts')
	applyMock.mockResolvedValueOnce({
		ok: true,
		response: {
			media: { title: 'Talk', publicationDate: null, description: 'd' },
			assignments: [],
			curatedFeeds: [],
			directoryFeeds: [],
		},
	})

	const result = await updateMediaMetadataTool({
		mediaRoot: 'series',
		relativePath: 'General Conference/2015-10/01-talk.mp3',
		description: 'd',
		bogus: 'ignored',
	} as never)

	expect(applyMock).toHaveBeenCalledWith(
		'series',
		'General Conference/2015-10/01-talk.mp3',
		{ description: 'd' },
	)
	expect(result.structuredContent).toMatchObject({
		updatedFields: ['description'],
	})
})

test('metadata tools surface editor errors as MCP tool errors', async () => {
	const { getMediaMetadataTool, updateMediaMetadataTool } =
		await import('./media-metadata-tools.ts')
	applyMock.mockResolvedValueOnce({
		ok: false,
		status: 400,
		error: 'Invalid path: directory traversal is not allowed',
	})
	readMock.mockResolvedValueOnce({
		ok: false,
		status: 404,
		error: 'Unknown media root',
	})

	const update = await updateMediaMetadataTool({
		mediaRoot: 'series',
		relativePath: '../etc/passwd',
		description: 'x',
	})
	expect(update.isError).toBe(true)

	const read = await getMediaMetadataTool({
		mediaRoot: 'nope',
		relativePath: 'a.mp3',
	})
	expect(read.isError).toBe(true)
})
