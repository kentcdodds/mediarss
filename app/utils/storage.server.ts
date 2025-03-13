import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { type ReadableStream } from 'stream/web'
import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import mime from 'mime-types'

const DATA_PATH = process.env.DATA_PATH
const IMAGES_PATH = path.join(DATA_PATH, 'images')

async function streamToFile(
	stream: ReadableStream<Uint8Array>,
	filePath: string,
): Promise<void> {
	const reader = stream.getReader()
	const writeStream = fs.createWriteStream(filePath)

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			writeStream.write(value)
		}
		writeStream.end()
	} catch (error) {
		writeStream.end()
		throw error
	}
}

async function uploadToStorage(file: File | FileUpload, key: string) {
	const fullPath = path.join(IMAGES_PATH, key)
	const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'))

	// Ensure the directory exists
	await fsPromises.mkdir(dirPath, { recursive: true })

	if (file instanceof File) {
		// For File objects, we can use the built-in stream
		const stream = file.stream() as ReadableStream<Uint8Array>
		await streamToFile(stream, fullPath)
	} else {
		// For FileUpload, use its stream
		await streamToFile(file.stream() as ReadableStream<Uint8Array>, fullPath)
	}

	return key
}

export async function uploadFeedImage(
	userId: string,
	feedId: string,
	file: File | FileUpload,
) {
	const fileId = createId()
	const fileExtension = file.name.split('.').pop() || ''
	const timestamp = Date.now()
	const key = `users/${userId}/feeds/${feedId}/images/${timestamp}-${fileId}.${fileExtension}`
	return uploadToStorage(file, key)
}

export async function getFeedImage(key: string) {
	const fullPath = path.join(IMAGES_PATH, key)

	// Check if file exists
	try {
		await fsPromises.access(fullPath)
	} catch {
		throw new Error(`Image not found: ${key}`)
	}

	// Get file stats for content type
	const stats = await fsPromises.stat(fullPath)
	const contentType = mime.lookup(fullPath) || 'application/octet-stream'

	return {
		stream: fs.createReadStream(fullPath),
		contentType,
		size: stats.size,
	}
}
