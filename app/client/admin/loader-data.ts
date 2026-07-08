import { type SerializableValue } from 'remix/ui'

export type AdminRouteLoaderArgs = {
	params: Record<string, string>
	url: string
	signal?: AbortSignal
}

export type AdminRouteLoader = (
	args: AdminRouteLoaderArgs,
) => Promise<AdminRouteLoaderData>

export type AdminRouteLoaderData =
	| { type: 'none' }
	| { type: 'feeds'; data: SerializableValue }
	| { type: 'create-feed'; data: SerializableValue }
	| { type: 'media-list'; data: SerializableValue }
	| { type: 'version'; data: SerializableValue }

export const noAdminRouteLoaderData: AdminRouteLoaderData = { type: 'none' }
