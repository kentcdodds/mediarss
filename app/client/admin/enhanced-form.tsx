import { clientEntry, type Handle } from 'remix/ui'

export const AdminEnhancement = clientEntry(
	'/app/client/admin/enhanced-form.tsx#AdminEnhancement',
	function AdminEnhancement(handle: Handle) {
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
			}

			frame.addEventListener('submit', submit)
			signal.addEventListener('abort', () => {
				frame.removeEventListener('submit', submit)
			})
		})

		return () => null
	},
)
