import {
	getAllFileMetadatas,
	getAllMediaWithDirectories,
} from '#app/utils/media.server.ts'
import { type Route } from './+types/_layout.ts'

export async function loader() {
	const mediaFiles = await getAllFileMetadatas()
	const mediaDirectories = await getAllMediaWithDirectories()
	const mediaFilesWithoutPictures = mediaFiles.map(
		({ picture, ...rest }) => rest,
	)

	return { mediaFiles: mediaFilesWithoutPictures, mediaDirectories }
}

export default function FeedsLayout({ loaderData }: Route.ComponentProps) {
	return <pre>{JSON.stringify(loaderData, null, 2)}</pre>
}
