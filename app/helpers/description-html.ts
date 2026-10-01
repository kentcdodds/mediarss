import sanitizeHtml from 'sanitize-html'

const sanitizeOptions: sanitizeHtml.IOptions = {
	allowedTags: [
		'p',
		'br',
		'strong',
		'b',
		'em',
		'i',
		'u',
		's',
		'sub',
		'sup',
		'blockquote',
		'ul',
		'ol',
		'li',
		'h3',
		'h4',
		'h5',
		'h6',
		'code',
		'pre',
		'a',
	],
	allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
	allowedSchemes: ['http', 'https', 'mailto'],
	allowedSchemesAppliedToAttributes: ['href'],
	allowProtocolRelative: false,
	disallowedTagsMode: 'discard',
	transformTags: {
		a: sanitizeHtml.simpleTransform('a', {
			target: '_blank',
			rel: 'noopener noreferrer nofollow',
		}),
	},
}

const htmlTagPattern = /<\/?[a-z][^>]*>/i

export function getDescriptionHtml(
	description: string | null | undefined,
): string | null {
	if (description == null || description.trim() === '') return null

	let html = sanitizeHtml(description, sanitizeOptions).trim()

	if (!htmlTagPattern.test(description)) {
		html = html.replace(/\r?\n/g, '<br>')
	}

	return html || null
}
