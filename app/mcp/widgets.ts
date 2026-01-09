/**
 * MCP-UI Widget HTML generators.
 *
 * Creates self-contained HTML pages for MCP-UI widgets that can be
 * rendered by ChatGPT and other MCP-UI compatible clients.
 */

import { createUIResource, type UIResource } from '@mcp-ui/server'
import { html } from '@remix-run/html-template'
import { encodeRelativePath } from '#app/helpers/feed-access.ts'

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
 * Generate the raw HTML string for the media player widget.
 *
 * This creates a self-contained HTML document that:
 * 1. Includes all necessary styles inline
 * 2. Includes the import map for module resolution
 * 3. Embeds the media data as a global variable (XSS-safe)
 * 4. Loads the widget script bundle
 */
export function generateMediaWidgetHtml(options: MediaWidgetOptions): string {
	const { baseUrl, media } = options

	// Resolve URLs to be absolute
	const resolveUrl = (url: string) => {
		if (url.startsWith('http')) return url
		return url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`
	}
	const artworkUrl = resolveUrl(media.artworkUrl)
	const streamUrl = resolveUrl(media.streamUrl)

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

	// Generate module preload links with properly escaped URLs
	const escapeHtmlAttr = (str: string) =>
		str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
	const modulePreloads = Object.values(absoluteImportmap.imports)
		.map((url) => `<link rel="modulepreload" href="${escapeHtmlAttr(url)}" />`)
		.join('\n\t\t\t')

	// Generate the HTML using the html template tag for safety
	// Note: We use html.raw for script content since we've already escaped it
	// Apply XSS escaping to import map JSON as well (baseUrl could contain malicious content)
	const importmapJson = escapeJsonForScript(absoluteImportmap)
	const escapedMediaData = escapeJsonForScript(mediaData)
	const escapedBaseUrl = escapeJsonForScript(baseUrl)

	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
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
 * Widget URI version for cache busting.
 * Increment this when making breaking changes to the widget.
 */
const WIDGET_VERSION = 'v1'

/**
 * Get the MCP-UI widget URI for a media player.
 * Uses the `ui://` scheme required by ChatGPT's Apps SDK.
 */
export function getMediaWidgetUIUri(): `ui://${string}` {
	return `ui://widget/media-player-${WIDGET_VERSION}.html`
}

/**
 * Generate the legacy MCP resource URI for a media widget.
 * This is used for backwards compatibility with existing code.
 */
export function getMediaWidgetUri(
	token: string,
	rootName: string,
	relativePath: string,
): string {
	const encodedPath = encodeRelativePath(relativePath)
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

	try {
		return {
			token: decodeURIComponent(match[1]!),
			rootName: decodeURIComponent(match[2]!),
			// Decode each segment individually to preserve slashes within segments
			relativePath: match[3]!
				.split('/')
				.map((segment) => decodeURIComponent(segment))
				.join('/'),
		}
	} catch {
		// Return null for malformed percent-encoded sequences
		return null
	}
}

/**
 * Options for creating a UIResource for the media widget.
 */
export interface CreateMediaWidgetResourceOptions {
	/** Base URL of the server for resource domain and widget resources */
	baseUrl: string
	/** Media data to display in the widget */
	media: MediaWidgetData
	/** Description of the widget (shown in ChatGPT) */
	description?: string
}

/**
 * Create a UIResource for the media player widget.
 *
 * This creates a resource compatible with ChatGPT's Apps SDK by:
 * 1. Using the `ui://` URI scheme
 * 2. Enabling the Apps SDK adapter
 * 3. Including OpenAI-specific metadata for CSP and widget description
 *
 * @param options - Options for creating the resource
 * @returns A UIResource that can be returned in tool results
 */
export function createMediaWidgetResource(
	options: CreateMediaWidgetResourceOptions,
): UIResource {
	const { baseUrl, media, description } = options

	// Generate the HTML for the widget
	const htmlString = generateMediaWidgetHtml({ baseUrl, media })

	// Get the origin (protocol + host) for CSP - OpenAI requires full URLs
	const hostname = new URL(baseUrl).origin

	return createUIResource({
		uri: getMediaWidgetUIUri(),
		content: {
			type: 'rawHtml',
			htmlString,
		},
		encoding: 'text',
		// Include media data as initial render data
		uiMetadata: {
			'initial-render-data': media as unknown as Record<string, unknown>,
		},
		// OpenAI-specific metadata for ChatGPT
		metadata: {
			'openai/widgetDescription':
				description ?? `Media player for ${media.title}`,
			'openai/widgetCSP': {
				connect_domains: [hostname],
				resource_domains: [hostname],
			},
		},
		// Enable the Apps SDK adapter for ChatGPT compatibility
		adapters: {
			appsSdk: {
				enabled: true,
			},
		},
	})
}

/**
 * OpenAI tool metadata for the get_media_widget tool.
 * These are added to the tool's _meta field.
 */
export function getMediaWidgetToolMeta(
	baseUrl: string,
): Record<string, unknown> {
	return {
		'openai/widgetDomain': baseUrl,
		'openai/outputTemplate': getMediaWidgetUIUri(),
		'openai/toolInvocation/invoking': 'Loading media player...',
		'openai/toolInvocation/invoked': 'Media player ready',
		'openai/resultCanProduceWidget': true,
		'openai/widgetAccessible': true,
	}
}
