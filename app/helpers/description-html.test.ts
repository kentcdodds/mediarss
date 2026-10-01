import { expect, test } from 'vitest'
import { getDescriptionHtml } from './description-html.ts'

function getSafeDescriptionHtml(description: string | null | undefined) {
	const html = getDescriptionHtml(description)
	expect(html ?? '').not.toMatch(/\son\w+=/i)
	return html
}

test('removes script elements and preserves safe content', () => {
	const html = getSafeDescriptionHtml('<p>Hello</p><script>alert(1)</script>')

	expect(html).toBe('<p>Hello</p>')
	expect(html).not.toMatch(/<script/i)
	expect(html).toContain('Hello')
})

test('removes script elements regardless of case and preserves text', () => {
	const html = getSafeDescriptionHtml(
		'<SCRIPT src="https://evil.example/x.js"></SCRIPT>text',
	)

	expect(html).toBe('text')
	expect(html).not.toMatch(/script/i)
	expect(html).toContain('text')
})

test('strips event handlers from allowed elements and preserves content', () => {
	const html = getSafeDescriptionHtml('<p onclick="alert(1)">Hi</p>')

	expect(html).toBe('<p>Hi</p>')
	expect(html).not.toMatch(/\son\w+=/i)
	expect(html).toContain('Hi')
})

test('discards images with event handlers', () => {
	const html = getSafeDescriptionHtml('<img src="x" onerror="alert(1)">')

	expect(html).toBeNull()
	expect(html ?? '').not.toMatch(/onerror/i)
	expect(html ?? '').not.toMatch(/<img/i)
})

test('strips anchor event handlers and preserves safe links', () => {
	const html = getSafeDescriptionHtml(
		'<a href="https://example.com" onmouseover="alert(1)">x</a>',
	)

	expect(html).toContain('href="https://example.com"')
	expect(html).not.toMatch(/onmouseover/i)
	expect(html).toContain('x')
})

test.each([
	'javascript:alert(1)',
	'JaVaScRiPt:alert(1)',
	'&#106;avascript:alert(1)',
	' javascript:alert(1)',
])('removes javascript URLs while preserving link text: %s', (href) => {
	const html = getSafeDescriptionHtml(`<a href="${href}">x</a>`)

	expect(html).not.toMatch(/javascript:/i)
	expect(html).not.toMatch(/\bhref=/i)
	expect(html).toContain('x')
})

test('strips styles and discards iframe and style elements', () => {
	const html = getSafeDescriptionHtml(
		'<p style="color:red">Safe</p><iframe src="https://evil.example">bad</iframe><style>.x{display:none}</style>',
	)

	expect(html).toContain('<p>Safe</p>')
	expect(html).not.toMatch(/style=|<iframe|<style/i)
})

test('drops data URLs and preserves link text', () => {
	const html = getSafeDescriptionHtml('<a href="data:text/html,evil">safe</a>')

	expect(html).not.toMatch(/data:/i)
	expect(html).not.toMatch(/\bhref=/i)
	expect(html).toContain('safe')
})

test('drops protocol-relative URLs and preserves link text', () => {
	const html = getSafeDescriptionHtml('<a href="//evil.example">safe</a>')

	expect(html).not.toContain('//evil.example')
	expect(html).not.toMatch(/\bhref=/i)
	expect(html).toContain('safe')
})

test('preserves safe formatting', () => {
	const html = getSafeDescriptionHtml(
		'<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>',
	)

	expect(html).toBe(
		'<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>',
	)
	expect(html).toContain('Bold')
	expect(html).toContain('One')
})

test('preserves safe links and adds safe target attributes', () => {
	const html = getSafeDescriptionHtml('<a href="https://example.com">x</a>')

	expect(html).toContain('href="https://example.com"')
	expect(html).toContain('target="_blank"')
	expect(html).toContain('rel="noopener noreferrer nofollow"')
	expect(html).toContain('x')
})

test('overwrites unsafe target and rel values', () => {
	const html = getSafeDescriptionHtml(
		'<a href="https://example.com" target="_self" rel="opener">x</a>',
	)

	expect(html).toContain('target="_blank"')
	expect(html).not.toContain('target="_self"')
	expect(html).toContain('rel="noopener noreferrer nofollow"')
	expect(html).not.toContain('rel="opener"')
	expect(html).toContain('x')
})

test('preserves line breaks in plain text descriptions', () => {
	const html = getSafeDescriptionHtml('Line one\nLine two')

	expect(html).toBe('Line one<br>Line two')
	expect(html).toContain('Line one')
	expect(html).toContain('Line two')
})

test('escapes HTML-sensitive characters in plain text', () => {
	const html = getSafeDescriptionHtml('5 < 6 & 7 > 3')

	expect(html).toBe('5 &lt; 6 &amp; 7 &gt; 3')
	expect(html).not.toContain('<')
	expect(html).toContain('5 &lt; 6')
})

test.each([null, undefined, '', '   ', '<script>x</script>'])(
	'returns null for empty descriptions: %s',
	(description) => {
		expect(getSafeDescriptionHtml(description)).toBeNull()
	},
)
