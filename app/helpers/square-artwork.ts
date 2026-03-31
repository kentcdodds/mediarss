import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ARTWORK_CACHE_DIR = path.join(process.cwd(), 'data', 'artwork-cache')
const SQUARE_ARTWORK_CACHE_VERSION = 'v1'

type SquareArtworkResult = {
	data: Buffer
	mimeType: string
}

type OutputFormat = {
	ext: 'jpg' | 'png' | 'webp'
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

function getOutputFormat(mimeType: string): OutputFormat {
	switch (mimeType) {
		case 'image/png':
			return { ext: 'png', mimeType: 'image/png' }
		case 'image/webp':
			return { ext: 'webp', mimeType: 'image/webp' }
		default:
			return { ext: 'jpg', mimeType: 'image/jpeg' }
	}
}

function getCacheKey(sourceKey: string): string {
	return createHash('sha256')
		.update(`${SQUARE_ARTWORK_CACHE_VERSION}:${sourceKey}`)
		.digest('hex')
}

async function ensureCacheDir(): Promise<void> {
	await fs.mkdir(ARTWORK_CACHE_DIR, { recursive: true })
}

async function tryReadCachedArtwork(
	cacheKey: string,
	format: OutputFormat,
): Promise<SquareArtworkResult | null> {
	const cachePath = path.join(ARTWORK_CACHE_DIR, `${cacheKey}.${format.ext}`)
	try {
		const data = await fs.readFile(cachePath)
		return { data, mimeType: format.mimeType }
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === 'ENOENT') {
			return null
		}
		throw error
	}
}

async function writeCachedArtwork(
	cacheKey: string,
	format: OutputFormat,
	data: Buffer,
): Promise<void> {
	await ensureCacheDir()
	const cachePath = path.join(ARTWORK_CACHE_DIR, `${cacheKey}.${format.ext}`)
	await fs.writeFile(cachePath, data)
}

async function transformToSquare(
	input: Buffer,
	mimeType: string,
): Promise<SquareArtworkResult> {
	const format = getOutputFormat(mimeType)
	const image = sharp(input, { failOn: 'none' })
	const metadata = await image.metadata()
	const width = metadata.width ?? 0
	const height = metadata.height ?? 0

	if (width <= 0 || height <= 0) {
		throw new Error('Unable to determine artwork dimensions')
	}

	const targetSize = Math.min(width, height)
	const left = Math.max(0, Math.floor((width - targetSize) / 2))
	const top = Math.max(0, Math.floor((height - targetSize) / 2))

	let pipeline = sharp(input, { failOn: 'none' })
	if (width !== height) {
		pipeline = pipeline.extract({
			left,
			top,
			width: targetSize,
			height: targetSize,
		})
	}

	let data: Buffer
	switch (format.mimeType) {
		case 'image/png':
			data = await pipeline.png().toBuffer()
			break
		case 'image/webp':
			data = await pipeline.webp({ quality: 90 }).toBuffer()
			break
		default:
			data = await pipeline.jpeg({ quality: 90 }).toBuffer()
			break
	}

	return {
		data,
		mimeType: format.mimeType,
	}
}

export async function getSquareArtwork(params: {
	data: Buffer
	mimeType: string
	sourceKey: string
}): Promise<SquareArtworkResult> {
	const { data, mimeType, sourceKey } = params
	const format = getOutputFormat(mimeType)
	const cacheKey = getCacheKey(sourceKey)
	const cached = await tryReadCachedArtwork(cacheKey, format)
	if (cached) {
		return cached
	}

	const transformed = await transformToSquare(data, mimeType)
	await writeCachedArtwork(
		cacheKey,
		getOutputFormat(transformed.mimeType),
		transformed.data,
	)
	return transformed
}

export async function getFileArtworkSourceKey(
	filePath: string,
): Promise<string> {
	const stats = await fs.stat(filePath)
	return `file:${path.resolve(filePath)}:${stats.mtimeMs}`
}

export async function getSquareArtworkFromFile(params: {
	filePath: string
	mimeType: string
}): Promise<SquareArtworkResult> {
	const { filePath, mimeType } = params
	const data = await fs.readFile(filePath)
	return getSquareArtwork({
		data,
		mimeType,
		sourceKey: await getFileArtworkSourceKey(filePath),
	})
}
