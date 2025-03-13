import { exec } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'util'
import { type IPicture } from 'music-metadata'

const execAsync = promisify(exec)

export async function extractVideoFrame(
	videoPath: string,
): Promise<IPicture | undefined> {
	try {
		// Create a temporary directory for the frame if it doesn't exist
		const tempDir = path.join(process.env.DATA_PATH, 'temp')
		await fs.promises.mkdir(tempDir, { recursive: true })

		// Generate a unique filename for the frame
		const framePath = path.join(tempDir, `${Date.now()}.jpg`)

		// Extract a frame from the video at 10% of its duration
		// This is a good balance between getting a meaningful frame and not waiting too long
		await execAsync(
			`ffmpeg -i "${videoPath}" -vf "select=eq(pict_type\\,I)" -vframes 1 -q:v 2 "${framePath}"`,
		)

		// Read the frame file
		const frameData = await fs.promises.readFile(framePath)

		// Clean up the temporary file
		await fs.promises.unlink(framePath)

		// Return the frame as an IPicture object
		return {
			format: 'image/jpeg',
			data: frameData,
		}
	} catch (error) {
		console.error('Error extracting video frame:', error)
		return undefined
	}
}
