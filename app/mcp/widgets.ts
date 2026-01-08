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
 * Generate a complete HTML page for the media player widget.
 *
 * This creates a self-contained HTML document that:
 * 1. Includes all necessary styles inline
 * 2. Embeds the media data as a global variable
 * 3. Loads the widget script bundle
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

	// Generate the HTML using the html template tag for safety
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${media.title} - Media Player</title>
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
				<script>
					// Embed media data for the widget to consume
					window.__MEDIA_DATA__ = ${JSON.stringify(mediaData)};
					window.__BASE_URL__ = ${JSON.stringify(baseUrl)};
				</script>
				<script type="module" src="${widgetScript}"></script>
			</body>
		</html>`.toString()
}

/**
 * Generate the MCP resource URI for a media widget
 */
export function getMediaWidgetUri(
	rootName: string,
	relativePath: string,
): string {
	return `media://widget/media/${encodeURIComponent(rootName)}/${encodeURIComponent(relativePath)}`
}

/**
 * Parse a media widget URI to extract rootName and relativePath
 */
export function parseMediaWidgetUri(
	uri: string,
): { rootName: string; relativePath: string } | null {
	const match = uri.match(/^media:\/\/widget\/media\/([^/]+)\/(.+)$/)
	if (!match) return null

	return {
		rootName: decodeURIComponent(match[1]!),
		relativePath: decodeURIComponent(match[2]!),
	}
}
