/**
 * MCP-UI Widget HTML generators.
 *
 * Creates self-contained HTML pages for MCP-UI widgets that can be
 * rendered by ChatGPT and other MCP-UI compatible clients.
 */
import { html } from '@remix-run/html-template'

/**
 * Media data structure for the widget
 */
export type MediaWidgetData = {
	title: string
	author: string | null
	duration: number | null
	sizeBytes: number
	mimeType: string
	publicationDate: string | null
	description: string | null
	narrators: string[] | null
	genres: string[] | null
	artworkUrl: string
	streamUrl: string
}

/**
 * Options for generating the media widget HTML
 */
export interface MediaWidgetOptions {
	/** Base URL of the server (for resolving relative URLs) */
	baseUrl: string
	/** Media data to display */
	media: MediaWidgetData
}

/**
 * Import map for the widget, matching the one in layout.tsx
 * This allows the widget to use bare module specifiers.
 */
const importmap = {
	imports: {
		'@remix-run/component': '/node_modules/@remix-run/component',
		'@remix-run/component/jsx-runtime':
			'/node_modules/@remix-run/component/jsx-runtime',
		'@remix-run/component/jsx-dev-runtime':
			'/node_modules/@remix-run/component/jsx-dev-runtime',
		'@remix-run/interaction': '/node_modules/@remix-run/interaction',
		'@remix-run/interaction/press':
			'/node_modules/@remix-run/interaction/press',
		'match-sorter': '/node_modules/match-sorter',
	},
}

/**
 * Safely encode JSON for embedding in script tags.
 * Prevents XSS by escaping sequences that could break out of script context.
 */
function escapeJsonForScript(data: unknown): string {
	return (
		JSON.stringify(data)
			// Escape </script> to prevent breaking out of script tag
			.replace(/</g, '\\u003c')
			// Escape --> to prevent breaking out of comments
			.replace(/>/g, '\\u003e')
			// Escape & for consistency
			.replace(/&/g, '\\u0026')
			// Escape line separators which are valid JSON but invalid JS
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029')
	)
}

/**
 * Generate a complete HTML page for the media player widget.
 *
 * This creates a self-contained HTML document that:
 * 1. Includes all necessary styles inline
 * 2. Includes the import map for module resolution
 * 3. Embeds the media data as a global variable (XSS-safe)
 * 4. Loads the widget script bundle
 *
 * The widget is designed to work in ChatGPT's MCP-UI context where
 * it will be sandboxed and rendered within the chat interface.
 */
export function generateMediaWidgetHtml(options: MediaWidgetOptions): string {
	const { baseUrl, media } = options

	// Resolve URLs to be absolute
	const artworkUrl = media.artworkUrl.startsWith('http')
		? media.artworkUrl
		: `${baseUrl}${media.artworkUrl}`
	const streamUrl = media.streamUrl.startsWith('http')
		? media.streamUrl
		: `${baseUrl}${media.streamUrl}`

	const mediaData: MediaWidgetData = {
		...media,
		artworkUrl,
		streamUrl,
	}

	// The widget entry script URL
	const widgetScript = `${baseUrl}/app/client/widgets/media-player.tsx`

	// Build absolute import map URLs
	const absoluteImportmap = {
		imports: Object.fromEntries(
			Object.entries(importmap.imports).map(([key, value]) => [
				key,
				`${baseUrl}${value}`,
			]),
		),
	}

	// Generate module preload links
	const modulePreloads = Object.values(absoluteImportmap.imports)
		.map((url) => `<link rel="modulepreload" href="${url}" />`)
		.join('\n\t\t\t')

	// Generate the HTML using the html template tag for safety
	// Note: We use html.raw for script content since we've already escaped it
	const importmapJson = JSON.stringify(absoluteImportmap)
	const escapedMediaData = escapeJsonForScript(mediaData)
	const escapedBaseUrl = escapeJsonForScript(baseUrl)

	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${media.title} - Media Player</title>
				${html.raw`<script type="importmap">${importmapJson}</script>`}
				${html.raw`${modulePreloads}`}
				<style>
					/* Reset and base styles */
					*,
					*::before,
					*::after {
						box-sizing: border-box;
					}

					body {
						margin: 0;
						padding: 0;
						font-family: system-ui, -apple-system, sans-serif;
						font-size: 1rem;
						line-height: 1.5;
						color: #f9f9f9;
						background-color: #0a0a0a;
					}

					img,
					video {
						max-width: 100%;
						height: auto;
					}

					/* Ensure audio/video controls are visible */
					audio::-webkit-media-controls-panel,
					video::-webkit-media-controls-panel {
						background-color: #1a1a1a;
					}

					/* Custom scrollbar for dark theme */
					::-webkit-scrollbar {
						width: 8px;
						height: 8px;
					}

					::-webkit-scrollbar-track {
						background: #141414;
					}

					::-webkit-scrollbar-thumb {
						background: #2a2a2a;
						border-radius: 4px;
					}

					::-webkit-scrollbar-thumb:hover {
						background: #3a3a3a;
					}
				</style>
			</head>
			<body>
				<div id="root"></div>
				${html.raw`<script>
					// Embed media data for the widget to consume
					window.__MEDIA_DATA__ = ${escapedMediaData};
					window.__BASE_URL__ = ${escapedBaseUrl};
				</script>`}
				<script type="module" src="${widgetScript}"></script>
			</body>
		</html>`.toString()
}

/**
 * Encode a relative path for use in URIs, encoding each segment individually.
 */
function encodeRelativePathForUri(relativePath: string): string {
	return relativePath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')
}

/**
 * Generate the MCP resource URI for a media widget
 */
export function getMediaWidgetUri(
	token: string,
	rootName: string,
	relativePath: string,
): string {
	const encodedPath = encodeRelativePathForUri(relativePath)
	return `media://widget/media/${encodeURIComponent(token)}/${encodeURIComponent(rootName)}/${encodedPath}`
}

/**
 * Parse a media widget URI to extract token, rootName and relativePath
 */
export function parseMediaWidgetUri(
	uri: string,
): { token: string; rootName: string; relativePath: string } | null {
	const match = uri.match(/^media:\/\/widget\/media\/([^/]+)\/([^/]+)\/(.+)$/)
	if (!match) return null

	return {
		token: decodeURIComponent(match[1]!),
		rootName: decodeURIComponent(match[2]!),
		relativePath: decodeURIComponent(match[3]!),
	}
}
