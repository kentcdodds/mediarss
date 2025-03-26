import { useCallback, useState } from 'react'
import { MediaTree } from '#app/components/media-tree.tsx'
import { getAllMediaWithDirectoriesNoPictures } from '#app/utils/media.server.ts'
import { type Route } from './+types/media.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const media = await getAllMediaWithDirectoriesNoPictures()

	return { media }
}

export default function MediaListPage({ loaderData }: Route.ComponentProps) {
	const { media } = loaderData
	const [selectedItem, setSelectedItem] = useState<
		(typeof media)[number] | null
	>(null)

	const handleSelect = useCallback((item: (typeof media)[number]) => {
		setSelectedItem(item)
		// TODO: Show popover with feed links for the selected item
	}, [])

	return (
		<div className="flex flex-col gap-8 p-8">
			<h1 className="text-2xl font-bold text-foreground">Media List</h1>

			<div className="flex flex-col gap-4">
				{/* File Tree */}
				<div className="min-h-[400px] rounded-md border border-border bg-card p-4">
					<MediaTree items={media} onSelect={handleSelect} />
				</div>
			</div>
		</div>
	)
}
