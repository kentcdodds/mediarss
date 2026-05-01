import { expect, test } from 'vitest'

import {
	handleEnhancedFormSubmit,
	submitEnhancedForm,
	submitFormNativelyOnNextSubmit,
} from './enhanced-form.tsx'

class TestForm extends EventTarget {
	action = 'https://example.com/admin/test'
	method = 'post'

	requestSubmit() {
		this.dispatchEvent(createSubmitEvent(this as unknown as HTMLFormElement))
	}
}

Object.defineProperty(globalThis, 'HTMLFormElement', {
	value: TestForm,
	configurable: true,
})

function createForm() {
	return new TestForm() as HTMLFormElement
}

function createSubmitEvent(form: HTMLFormElement) {
	const event = new Event('submit', { cancelable: true })
	Object.defineProperty(event, 'target', { value: form })
	return event
}

function createFrame() {
	return {
		replacedContent: '',
		reloaded: false,
		src: '',
		async replace(content: string) {
			this.replacedContent = content
		},
		async reload() {
			this.reloaded = true
		},
	}
}

function createLocation() {
	return {
		assign() {
			throw new Error('location.assign should not run')
		},
	}
}

test('falls back to native form submission when enhanced fetch rejects', async () => {
	const form = createForm()
	const controller = new AbortController()
	let submittedForm: HTMLFormElement | undefined

	await submitEnhancedForm(form, {
		createFormData: () => new FormData(),
		fetch: async () => {
			throw new TypeError('NetworkError')
		},
		frame: createFrame(),
		location: createLocation(),
		onFetchError(failedForm) {
			submittedForm = failedForm
		},
		signal: controller.signal,
	})

	expect(submittedForm).toBe(form)
})

test('does not fall back when the enhanced fetch is aborted', async () => {
	const form = createForm()
	const controller = new AbortController()
	controller.abort()
	let submitted = false

	await submitEnhancedForm(form, {
		createFormData: () => new FormData(),
		fetch: async () => {
			throw new DOMException('Aborted', 'AbortError')
		},
		frame: createFrame(),
		location: createLocation(),
		onFetchError() {
			submitted = true
		},
		signal: controller.signal,
	})

	expect(submitted).toBe(false)
})

test('enhanced form submit fallback lets the retried submit continue uncancelled', async () => {
	const form = createForm()
	let retriedEvent: Event | undefined
	const event = createSubmitEvent(form)
	form.addEventListener('submit', (retryEvent) => {
		retriedEvent = retryEvent
		void handleEnhancedFormSubmit(retryEvent, {
			createFormData: () => new FormData(),
			fetch: async () => {
				throw new Error('second enhanced submit should not run')
			},
			frame: createFrame(),
			location: createLocation(),
			onFetchError() {
				throw new Error('second enhanced fallback should not run')
			},
			signal: new AbortController().signal,
		})
	})

	await handleEnhancedFormSubmit(event, {
		createFormData: () => new FormData(),
		fetch: async () => {
			throw new TypeError('NetworkError')
		},
		frame: createFrame(),
		location: createLocation(),
		onFetchError: submitFormNativelyOnNextSubmit,
		signal: new AbortController().signal,
	})

	expect(event.defaultPrevented).toBe(true)
	expect(retriedEvent?.defaultPrevented).toBe(false)
})
