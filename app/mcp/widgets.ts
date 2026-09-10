/**
 * MCP-UI Widget HTML generators.
 *
 * Creates self-contained HTML pages for MCP-UI widgets that can be
 * rendered by ChatGPT and other MCP-UI compatible clients.
 *
 * The widget uses the MCP-UI protocol to receive initial render data
 * from ChatGPT via postMessage, rather than embedding data inline.
 */

import { createHash } from 'node:crypto'
import { createUIResource, type UIResource } from '@mcp-ui/server'
import { type ScriptEntry } from 'remix/assets'
import { html } from 'remix/html-template'
import { MEDIA_WIDGET_ENTRY, getScriptEntry } from '#app/assets.ts'

/**
 * Media data structure for the widget.
 * This is passed via the MCP-UI initial-render-data protocol.
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
 * The widget document is served from ChatGPT's sandboxed origin, so every
 * module URL (entry, preloads, and import map keys/values) must be absolute.
 */
function toAbsoluteScriptEntry(
	entry: ScriptEntry,
	baseUrl: string,
): ScriptEntry {
	const absolute = (url: string) => new URL(url, baseUrl).href
	// Bare specifiers (e.g. `remix/ui`) stay as-is; URL-like keys are resolved
	// against the server origin because the browser resolves import map keys
	// relative to the embedding document, not the module server.
	const absoluteSpecifier = (specifier: string) =>
		specifier.startsWith('/') || specifier.startsWith('.')
			? absolute(specifier)
			: specifier
	const absoluteMappings = (mappings: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(mappings).map(([specifier, url]) => [
				absoluteSpecifier(specifier),
				absolute(url),
			]),
		)

	return {
		href: absolute(entry.href),
		preloads: entry.preloads.map(absolute),
		importMap: {
			imports: absoluteMappings(entry.importMap.imports),
			...(entry.importMap.scopes
				? {
						scopes: Object.fromEntries(
							Object.entries(entry.importMap.scopes).map(
								([scope, mappings]) => [
									absolute(scope),
									absoluteMappings(mappings),
								],
							),
						),
					}
				: {}),
		},
	}
}

/**
 * Generate the raw HTML string for the media player widget.
 *
 * This creates a minimal HTML document that:
 * 1. Includes all necessary styles inline
 * 2. Includes the import map for module resolution
 * 3. Loads the widget script entry
 *
 * The widget receives its data via the MCP-UI initial-render-data protocol,
 * NOT embedded inline. This is the correct pattern for ChatGPT Apps SDK.
 */
export async function generateMediaWidgetHtml(
	options: MediaWidgetOptions,
): Promise<string> {
	const { baseUrl } = options

	const { href, importMap, preloads } = toAbsoluteScriptEntry(
		await getScriptEntry(MEDIA_WIDGET_ENTRY),
		baseUrl,
	)

	const modulePreloads = preloads.map(
		(url) => html`<link rel="modulepreload" href="${url}" />`,
	)

	// Apply XSS escaping to import map JSON for safe embedding in script context
	const importmapJson = escapeJsonForScript(importMap)

	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>Media Player</title>
				${html.raw`<script type="importmap">
					${importmapJson}
				</script>`}
				${modulePreloads}
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
						font-family:
							system-ui,
							-apple-system,
							sans-serif;
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
				<script type="module" src="${href}"></script>
			</body>
		</html>`.toString()
}

/**
 * Get the MCP-UI widget URI for a media player.
 * Uses the `ui://` scheme required by ChatGPT's Apps SDK.
 * The version is derived from the fingerprinted widget module graph so the
 * URI changes whenever the widget code (or its dependencies) change.
 */
export async function getMediaWidgetUIUri(): Promise<`ui://${string}`> {
	const scriptEntry = await getScriptEntry(MEDIA_WIDGET_ENTRY)
	const version = createHash('sha256')
		.update(JSON.stringify(scriptEntry))
		.digest('hex')
		.slice(0, 8)
	return `ui://widget/media-player-${version}.html`
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
 * Resolve relative URLs in media data to absolute URLs.
 * Handles http://, https://, data:, blob:, and relative URLs correctly.
 */
function resolveMediaUrls(
	media: MediaWidgetData,
	baseUrl: string,
): MediaWidgetData {
	const resolveUrl = (url: string) => {
		// Handle empty URLs
		if (!url) return url

		// Try to parse as absolute URL (handles http://, https://, data:, blob:, etc.)
		try {
			new URL(url)
			return url // Already absolute
		} catch {
			// Relative URL - resolve against baseUrl
			try {
				return new URL(url, baseUrl).href
			} catch {
				// Fallback for malformed URLs
				return url
			}
		}
	}

	return {
		...media,
		artworkUrl: resolveUrl(media.artworkUrl),
		streamUrl: resolveUrl(media.streamUrl),
	}
}

/**
 * Create a UIResource for the media player widget.
 *
 * This creates a resource compatible with ChatGPT's Apps SDK by:
 * 1. Using the `ui://` URI scheme
 * 2. Enabling the Apps SDK adapter
 * 3. Including OpenAI-specific metadata for CSP and widget description
 * 4. Passing media data via initial-render-data (NOT embedded in HTML)
 *
 * @param options - Options for creating the resource
 * @returns A UIResource that can be returned in tool results
 */
export async function createMediaWidgetResource(
	options: CreateMediaWidgetResourceOptions,
): Promise<UIResource> {
	const { baseUrl, media, description } = options

	// Generate the minimal HTML shell (no embedded data)
	const [htmlString, uri] = await Promise.all([
		generateMediaWidgetHtml({ baseUrl }),
		getMediaWidgetUIUri(),
	])

	// Resolve relative URLs to absolute URLs for the widget
	const resolvedMedia = resolveMediaUrls(media, baseUrl)

	// Get the origin (protocol + host) for CSP - OpenAI requires full URLs
	const cspOrigin = new URL(baseUrl).origin

	return createUIResource({
		uri,
		content: {
			type: 'rawHtml',
			htmlString,
		},
		encoding: 'text',
		// Pass media data via MCP-UI initial-render-data protocol
		uiMetadata: {
			'initial-render-data': resolvedMedia as unknown as Record<
				string,
				unknown
			>,
		},
		// OpenAI-specific metadata for ChatGPT
		metadata: {
			'openai/widgetDescription':
				description ?? `Media player for ${media.title}`,
			'openai/widgetCSP': {
				connect_domains: [cspOrigin],
				resource_domains: [cspOrigin],
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
export async function getMediaWidgetToolMeta(
	baseUrl: string,
): Promise<Record<string, unknown>> {
	return {
		'openai/widgetDomain': baseUrl,
		'openai/outputTemplate': await getMediaWidgetUIUri(),
		'openai/toolInvocation/invoking': 'Loading media player...',
		'openai/toolInvocation/invoked': 'Media player ready',
		'openai/resultCanProduceWidget': true,
		'openai/widgetAccessible': true,
	}
}
