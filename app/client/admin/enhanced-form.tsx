import { clientEntry, type Handle, type RemixNode } from 'remix/ui'

type AdminEnhancementProps = {
	children?: RemixNode
}

export const AdminEnhancement = clientEntry(
	'/app/client/admin/enhanced-form.tsx#AdminEnhancement',
	function AdminEnhancement(handle: Handle<AdminEnhancementProps>) {
		handle.queueTask((signal) => {
			const frame = document.querySelector('[data-admin-frame]')
			if (!frame) return

			const submit = async (event: Event) => {
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

			if (!response.redirected) {
				if (response.status >= 500) {
					window.location.assign(response.url)
					return
				}
				const content = await response.text()
				if (signal.aborted) return
				await handle.frame.replace(content)
				return
			}

			const location = response.headers.get('Location') ?? response.url
			const nextUrl = new URL(location, window.location.href)

			handle.frame.src = nextUrl.href
			window.history.pushState(null, '', nextUrl)
			await handle.frame.reload()
		}

			frame.addEventListener('submit', submit)
			signal.addEventListener('abort', () => {
				frame.removeEventListener('submit', submit)
			})
		})

		return () => (
			<div data-admin-frame>
				{handle.props.children}
			</div>
		)
	},
)
