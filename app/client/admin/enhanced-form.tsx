import { clientEntry, type Handle, type RemixNode } from 'remix/ui'

type AdminEnhancementProps = {
	children?: RemixNode
}

type EnhancedFormFrame = {
	replace(content: string): Promise<void>
	reload(): Promise<unknown>
	src: string
}

type NativeSubmitOptions = {
	submitter?: HTMLElement | null
}

type EnhancedFormSubmitOptions = {
	createFormData: (form: HTMLFormElement) => FormData
	fetch: typeof fetch
	frame: EnhancedFormFrame
	location: Pick<Location, 'assign'>
	onFetchError: (form: HTMLFormElement, options?: NativeSubmitOptions) => void
	signal: AbortSignal
	submitter?: HTMLElement | null
}

type EnhancedFormSubmitHandlerOptions = Omit<
	EnhancedFormSubmitOptions,
	'submitter'
>

export async function submitEnhancedForm(
	form: HTMLFormElement,
	options: EnhancedFormSubmitOptions,
) {
	let response: Response
	try {
		response = await options.fetch(form.action, {
			method: 'POST',
			body: options.createFormData(form),
			headers: { 'x-remix-target': 'admin-main' },
			signal: options.signal,
		})
	} catch {
		if (options.signal.aborted) return
		options.onFetchError(form, { submitter: options.submitter })
		return
	}
	if (options.signal.aborted) return

	if (!response.redirected) {
		if (response.status >= 500) {
			options.location.assign(response.url)
			return
		}
		const content = await response.text()
		if (options.signal.aborted) return
		await options.frame.replace(content)
		return
	}

	const location = response.headers.get('Location') ?? response.url
	const nextUrl = new URL(location, window.location.href)

	options.frame.src = nextUrl.href
	window.history.pushState(null, '', nextUrl)
	await options.frame.reload()
}

function getSubmitter(event: Event) {
	return typeof HTMLElement !== 'undefined' &&
		'submitter' in event &&
		event.submitter instanceof HTMLElement
		? event.submitter
		: null
}

function submitNatively(
	form: HTMLFormElement,
	options: NativeSubmitOptions = {},
) {
	if (
		typeof HTMLElement !== 'undefined' &&
		options.submitter instanceof HTMLElement
	) {
		form.requestSubmit(options.submitter)
		return
	}
	form.requestSubmit()
}

const nativeSubmitForms = new WeakSet<HTMLFormElement>()

export function submitFormNativelyOnNextSubmit(
	form: HTMLFormElement,
	options?: NativeSubmitOptions,
) {
	nativeSubmitForms.add(form)
	submitNatively(form, options)
}

export async function handleEnhancedFormSubmit(
	event: Event,
	options: EnhancedFormSubmitHandlerOptions,
) {
	const form = event.target
	if (!(form instanceof HTMLFormElement)) return
	if (form.method.toLowerCase() !== 'post') return
	if (nativeSubmitForms.has(form)) {
		nativeSubmitForms.delete(form)
		return
	}

	event.preventDefault()

	await submitEnhancedForm(form, {
		...options,
		submitter: getSubmitter(event),
	})
}

export const AdminEnhancement = clientEntry(
	'/app/client/admin/enhanced-form.tsx#AdminEnhancement',
	function AdminEnhancement(handle: Handle<AdminEnhancementProps>) {
		handle.queueTask((signal) => {
			const frame = document.querySelector('[data-admin-frame]')
			if (!frame) return

			const submit = async (event: Event) => {
				await handleEnhancedFormSubmit(event, {
					createFormData: (submittedForm) => new FormData(submittedForm),
					fetch,
					frame: handle.frame,
					location: window.location,
					onFetchError: submitFormNativelyOnNextSubmit,
					signal,
				})
			}

			frame.addEventListener('submit', submit)
			signal.addEventListener('abort', () => {
				frame.removeEventListener('submit', submit)
			})
		})

		return () => <div data-admin-frame>{handle.props.children}</div>
	},
)
