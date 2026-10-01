import { type SerializableValue } from 'remix/ui'

export type AdminRouteLoaderData =
	| { type: 'none' }
	| { type: 'feeds'; data: SerializableValue }
	| { type: 'create-feed'; data: SerializableValue }
	| { type: 'media-list'; data: SerializableValue }
	| { type: 'version'; data: SerializableValue }

export type AdminRoutePageProps = {
	params: Record<string, string>
	loaderData?: AdminRouteLoaderData
	url?: string
}

export const noAdminRouteLoaderData: AdminRouteLoaderData = { type: 'none' }
