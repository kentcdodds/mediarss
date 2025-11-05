export function ModulePreload({ url }: { url: string }) {
	return <link rel="modulepreload" href={url} />
}
