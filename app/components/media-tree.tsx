import { rankings, matchSorter } from 'match-sorter'
import { useMemo, useState, useRef, useImperativeHandle } from 'react'
import { flushSync } from 'react-dom'
import {
	type getAllMediaWithDirectoriesNoPictures,
	type MediaNode,
} from '#app/utils/media.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

interface MediaTreeProps {
	items: Awaited<ReturnType<typeof getAllMediaWithDirectoriesNoPictures>>
	defaultFilter?: string
	onSelect?: (item: MediaNode) => void
}

interface TreeNodeProps extends MediaTreeProps {
	level?: number
	handle: (handle: TreeNodeHandle) => void
	initAllExpanded?: boolean
	directoriesWithMatchingChildren: Array<string>
}

interface TreeNodeHandle {
	expandAll: () => void
	collapseAll: () => void
}

function TreeNode({
	items,
	level = 0,
	onSelect,
	handle,
	initAllExpanded = false,
	directoriesWithMatchingChildren,
}: TreeNodeProps) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		if (!initAllExpanded) return {}
		const initialExpanded: Record<string, boolean> = {}
		for (const item of items) {
			initialExpanded[item.id] = true
		}
		return initialExpanded
	})
	const childRefs = useRef<TreeNodeHandle[]>([])
	const initChildrenExpanded = useRef(initAllExpanded)

	const sortedItems = useMemo(() => {
		return [...items].sort((a, b) => {
			// If both are same type, sort alphabetically
			if (a.type === b.type) {
				return a.name.localeCompare(b.name)
			}
			// Directories come first
			return a.type === 'directory' ? -1 : 1
		})
	}, [items])

	const toggleExpand = (itemId: string) => {
		setExpanded((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
	}

	useImperativeHandle<TreeNodeHandle, TreeNodeHandle>(handle, () => ({
		expandAll: () => {
			initChildrenExpanded.current = true
			const allExpanded: Record<string, boolean> = {}
			for (const item of items) {
				if (item.type === 'directory') {
					allExpanded[item.id] = true
				}
			}
			setExpanded(allExpanded)
			for (const ref of childRefs.current) {
				ref?.expandAll()
			}
			// Once everything's rendered then we can remove the initial expanded state
			flushSync(() => {})
			initChildrenExpanded.current = false
		},
		collapseAll: () => {
			setExpanded({})
			for (const ref of childRefs.current) {
				ref?.collapseAll()
			}
		},
	}))

	return (
		<ul className={cn('list-none', level > 0 ? 'ml-4' : '')}>
			{sortedItems.map((item, index) => {
				if (item.name.includes('kids')) debugger
				const isExpanded =
					expanded[item.id] ||
					directoriesWithMatchingChildren?.includes(item.id)
				const hasChildren = item.type === 'directory' && item.children?.length
				const showChildren = hasChildren && isExpanded

				return (
					<li key={item.id} className="overflow-x-auto py-1">
						<button
							className={cn(
								'group flex items-center gap-1 rounded-md px-2 py-1',
								'hover:bg-accent hover:text-accent-foreground',
								'cursor-pointer select-none',
							)}
							onClick={() => {
								if (hasChildren) {
									toggleExpand(item.id)
								}
								onSelect?.(item)
							}}
						>
							<span className="text-muted-foreground">
								{hasChildren ? (
									isExpanded ? (
										<Icon name="chevron-down" size="sm" />
									) : (
										<Icon name="chevron-right" size="sm" />
									)
								) : (
									<span className="ml-4" />
								)}
							</span>
							<span className="text-muted-foreground">
								{item.type === 'directory' ? (
									<Icon name="folder" size="sm" />
								) : (
									<Icon name="file" size="sm" />
								)}
							</span>
							<span className="flex-1 truncate text-left text-sm">
								{item.name}
							</span>
						</button>
						{showChildren && item.children ? (
							<TreeNode
								handle={(handle) => {
									childRefs.current[index] = handle
								}}
								initAllExpanded={initChildrenExpanded.current}
								directoriesWithMatchingChildren={
									directoriesWithMatchingChildren
								}
								items={item.children}
								level={level + 1}
								onSelect={onSelect}
							/>
						) : null}
					</li>
				)
			})}
		</ul>
	)
}

function getItemMatches(
	item: MediaNode,
	directoriesWithMatchingChildren: Array<string>,
	filter?: string,
): MediaNode | null {
	if (!filter) return item

	const matches =
		matchSorter([item], filter, {
			keys: [
				'metadata.title',
				'metadata.author',
				'name',
				'metadata.genre',
				{ key: 'id', threshold: rankings.STARTS_WITH },
			],
		}).length > 0

	if (item.type === 'directory') {
		const matchingChildren: Array<MediaNode> = []
		for (const child of item.children) {
			const match = getItemMatches(
				child,
				directoriesWithMatchingChildren,
				filter,
			)
			if (match) {
				matchingChildren.push(match)
			}
		}
		if (matchingChildren.length > 0) {
			directoriesWithMatchingChildren.push(item.id)
			return {
				...item,
				children: matchingChildren,
			}
		}
	}

	return matches ? item : null
}

function filterMediaItems(items: Array<MediaNode>, filter?: string) {
	const directoriesWithMatchingChildren: Array<string> = []
	if (!filter) return { items, directoriesWithMatchingChildren }

	const rootMediaItem: MediaNode = {
		id: '',
		name: '',
		path: '',
		type: 'directory',
		children: items,
	}

	const match = getItemMatches(
		rootMediaItem,
		directoriesWithMatchingChildren,
		filter,
	)

	if (match === rootMediaItem) {
		return { items, directoriesWithMatchingChildren }
	}
	console.log(directoriesWithMatchingChildren)

	return { items: match?.children ?? [], directoriesWithMatchingChildren }
}

export function MediaTree({
	items,
	defaultFilter = '',
	onSelect,
}: MediaTreeProps) {
	const [filter, setFilter] = useState(defaultFilter)
	const filteredItems = useMemo(
		() => filterMediaItems(items, filter),
		[items, filter],
	)
	const treeRef = useRef<TreeNodeHandle>(null)

	return (
		<div className="w-full space-y-4">
			<div className="relative">
				<div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
					<Icon name="magnifying-glass" size="sm" />
				</div>
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.currentTarget.value)}
					placeholder="Filter media..."
					className="h-10 w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				/>
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => treeRef.current?.expandAll()}
					className="rounded-md bg-accent px-2 py-1 text-sm text-accent-foreground hover:bg-accent/80"
				>
					<span className="flex items-center gap-1">
						<Icon name="chevron-down" size="sm" />
						Expand All
					</span>
				</button>
				<button
					onClick={() => treeRef.current?.collapseAll()}
					className="rounded-md bg-accent px-2 py-1 text-sm text-accent-foreground hover:bg-accent/80"
				>
					<span className="flex items-center gap-1">
						<Icon name="chevron-right" size="sm" />
						Collapse All
					</span>
				</button>
			</div>
			<TreeNode
				handle={(handle) => {
					treeRef.current = handle
				}}
				directoriesWithMatchingChildren={
					filteredItems.directoriesWithMatchingChildren
				}
				items={filteredItems.items}
				onSelect={onSelect}
			/>
		</div>
	)
}
