// these images come right from the file itself
import { getMetadataById } from '#app/utils/media.server.ts'
import { extractVideoFrame } from '#app/utils/video.server.ts'
import { type Route } from './+types/media-image.$fileId'

export async function loader({ params }: Route.LoaderArgs) {
	const { fileId } = params
	if (!fileId) {
		throw new Response('Not Found', {
			status: 404,
			headers: { reason: 'Missing fileId' },
		})
	}
	const item = await getMetadataById(fileId)
	if (!item) {
		throw new Response('Not Found', {
			status: 404,
			headers: {
				reason: `No item matching id "${fileId}"`,
			},
		})
	}

	let picture = item.picture
	if (!picture) {
		// If no picture is available, check if it's a video and extract a frame
		if (item.type.startsWith('video/')) {
			picture = await extractVideoFrame(item.filepath)
		}
		if (!picture) {
			throw new Response('Not Found', {
				status: 404,
				headers: { reason: 'No picture or video frame available' },
			})
		}
	}

	const { format, data } = picture
	return new Response(data, {
		headers: {
			'Content-Type': format,
		},
	})
}
