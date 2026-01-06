/**
 * Generate a simple placeholder SVG for feeds/items without artwork.
 * Uses the first character of the title as a visual indicator.
 */
export function generatePlaceholderSvg(title: string): string {
	// Get first letter or emoji for the placeholder
	const firstChar = title.trim()[0]?.toUpperCase() ?? '?'

	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="#1a1a2e"/>
  <text x="300" y="340" font-family="system-ui, sans-serif" font-size="200" font-weight="bold" fill="#e94560" text-anchor="middle">${firstChar}</text>
</svg>`
}
