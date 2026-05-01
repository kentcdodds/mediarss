import { clientEntry, on, type Handle, type RemixNode } from 'remix/ui'

type AdminEnhancementProps = {
	children?: RemixNode
}

export const AdminEnhancement = clientEntry(
	'/app/client/admin/enhanced-form.tsx#AdminEnhancement',
	function AdminEnhancement(handle: Handle<AdminEnhancementProps>) {
		return () => (
			<div
				data-admin-frame
				mix={on<HTMLDivElement, 'submit'>('submit', async (event, signal) => {
					const frame = event.currentTarget
					const form = event.target
					if (!(form instanceof HTMLFormElement)) return
					if (form.method.toLowerCase() !== 'post') return

					event.preventDefault()

					const response = await fetch(form.action, {
						method: 'POST',
						body: new FormData(form),
						signal,
					})
					if (signal.aborted) return

					const location = response.headers.get('Location') ?? response.url
					const nextUrl = new URL(location, window.location.href)
					const frameResponse = await fetch(nextUrl, {
						headers: { 'x-remix-target': 'admin-main' },
						signal,
					})
					if (signal.aborted) return

					if (!frameResponse.ok && frameResponse.status >= 500) {
						window.location.assign(nextUrl)
						return
					}

					window.history.pushState(null, '', nextUrl)
					frame.innerHTML = await frameResponse.text()
				})}
			>
				{handle.props.children}
			</div>
		)
	},
)
