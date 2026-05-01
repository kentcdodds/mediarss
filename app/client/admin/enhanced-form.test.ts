import { expect, test } from 'vitest'

import { submitEnhancedForm } from './enhanced-form.tsx'

function createForm() {
	return {
		action: 'https://example.com/admin/test',
	} as HTMLFormElement
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
