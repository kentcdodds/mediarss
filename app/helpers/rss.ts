import { invariant } from '@epic-web/invariant'
import { resolveMediaPath } from '#app/config/env.ts'
import type { DirectoryFeed, Feed } from '#app/db/types.ts'
import type { MediaFile } from './media.ts'

/**
 * Options for generating an RSS feed.
 */
export type RSSGeneratorOptions = {
	/** The feed configuration */
	feed: Feed
	/** The media files to include in the feed */
	items: Array<MediaFile>
	/** The base URL for the server (e.g., "https://example.com") */
	baseUrl: string
	/** The token used to access this feed */
	token: string
	/** The full URL to the feed itself */
	feedUrl: string
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string | null | undefined): string {
	if (!str) return ''
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

/**
 * Wrap content in CDATA if it contains special characters.
 */
function cdata(str: string | null | undefined | object): string {
	if (!str) return ''
	// Handle objects that might be passed (edge case in metadata)
	if (typeof str === 'object') {
		str = JSON.stringify(str)
	}
	// If it contains any XML special characters, use CDATA
	if (/[<>&]/.test(str)) {
		// CDATA cannot contain "]]>" so we need to escape it
		const escaped = str.replace(/\]\]>/g, ']]]]><![CDATA[>')
		return `<![CDATA[${escaped}]]>`
	}
	return escapeXml(str)
}

/**
 * Format duration in HH:MM:SS format for iTunes.
 */
function formatDuration(seconds: number | null): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
		return ''
	}

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = Math.floor(seconds % 60)

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
	}
	return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format a date as RFC 2822 for RSS.
 */
function formatRssDate(date: Date): string {
	return date.toUTCString()
}

/**
 * Generate a fallback publication date for items without one.
 * Uses a base date of 1900-01-01 and increments by 1 minute per item index.
 * This ensures sort order is preserved when podcast clients sort by pubDate.
 */
function getFallbackDate(index: number): Date {
	const baseDate = new Date('1900-01-01T00:00:00Z')
	return new Date(baseDate.getTime() + index * 60 * 1000)
}

/**
 * Generate a unique ID for a media file.
 * Uses a hash of the file path for URL-safe identification.
 */
function generateItemId(item: MediaFile): string {
	// Use a simple hash of the path for URL-safe unique ID
	// This handles non-ASCII characters properly
	const encoder = new TextEncoder()
	const data = encoder.encode(item.path)
	let hash = 0
	for (const byte of data) {
		hash = ((hash << 5) - hash + byte) | 0
	}
	// Convert to hex and ensure it's positive
	const hexHash = (hash >>> 0).toString(16).padStart(8, '0')
	// Add filename for readability
	const safeFilename = item.filename
		.replace(/[^a-zA-Z0-9.-]/g, '_')
		.slice(0, 50)
	return `${safeFilename}-${hexHash}`
}

/**
 * Build the URL for streaming a media file.
 * Uses format: /media/:token/:rootName/:relativePath
 */
function getMediaUrl(baseUrl: string, token: string, filePath: string): string {
	const resolved = resolveMediaPath(filePath)
	invariant(
		resolved,
		`File "${filePath}" is not within any configured media root. Check MEDIA_PATHS configuration.`,
	)
	const encodedRelativePath = encodeURIComponent(resolved.relativePath)
	return `${baseUrl}/media/${token}/${resolved.root.name}/${encodedRelativePath}`
}

/**
 * Build the URL for item artwork.
 * Uses format: /art/:token/:rootName/:relativePath
 */
function getArtworkUrl(
	baseUrl: string,
	token: string,
	filePath: string,
): string {
	const resolved = resolveMediaPath(filePath)
	invariant(
		resolved,
		`File "${filePath}" is not within any configured media root. Check MEDIA_PATHS configuration.`,
	)
	const encodedRelativePath = encodeURIComponent(resolved.relativePath)
	return `${baseUrl}/art/${token}/${resolved.root.name}/${encodedRelativePath}`
}

/**
 * Generate a single RSS item element.
 */
function generateItem(
	item: MediaFile,
	index: number,
	baseUrl: string,
	token: string,
): string {
	const itemId = generateItemId(item)
	const pubDate = item.publicationDate
		? formatRssDate(item.publicationDate)
		: formatRssDate(getFallbackDate(index))
	const mediaUrl = getMediaUrl(baseUrl, token, item.path)
	const artworkUrl = getArtworkUrl(baseUrl, token, item.path)
	const duration = formatDuration(item.duration)

	return `    <item>
      <guid isPermaLink="false">${escapeXml(itemId)}</guid>
      <title>${escapeXml(item.title)}</title>
      <description>${cdata(item.description)}</description>
      <pubDate>${pubDate}</pubDate>
      ${item.author ? `<author>${escapeXml(item.author)}</author>` : ''}
      <content:encoded>${cdata(item.description)}</content:encoded>
      <enclosure url="${escapeXml(mediaUrl)}" length="${item.sizeBytes}" type="${escapeXml(item.mimeType)}" />
      <itunes:title>${escapeXml(item.title)}</itunes:title>
      ${item.author ? `<itunes:author>${escapeXml(item.author)}</itunes:author>` : ''}
      ${duration ? `<itunes:duration>${duration}</itunes:duration>` : ''}
      <itunes:image href="${escapeXml(artworkUrl)}" />
      <itunes:summary>${cdata(item.description)}</itunes:summary>
      <itunes:subtitle>${cdata(item.description?.slice(0, 255))}</itunes:subtitle>
      <itunes:explicit>no</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`
}

/**
 * Check if a feed is a DirectoryFeed.
 */
function _isDirectoryFeed(feed: Feed): feed is DirectoryFeed {
	return 'directoryPaths' in feed
}

/**
 * Generate a complete RSS feed XML string.
 */
export function generateRssFeed(options: RSSGeneratorOptions): string {
	const { feed, items, baseUrl, token, feedUrl } = options

	// Get feed metadata
	const title = escapeXml(feed.name)
	const description = cdata(feed.description || `Podcast feed: ${feed.name}`)
	const link = escapeXml(feed.link || feedUrl)
	const imageUrl = feed.imageUrl
		? escapeXml(feed.imageUrl)
		: `${baseUrl}/art/${token}/feed`
	const author = escapeXml(feed.author)
	const ownerName = escapeXml(feed.ownerName || feed.author)
	const ownerEmail = escapeXml(feed.ownerEmail)
	const language = escapeXml(feed.language || 'en')
	const explicit = escapeXml(feed.explicit || 'no')
	const category = escapeXml(feed.category)

	const lastBuildDate = formatRssDate(new Date())

	// Generate items
	const itemsXml = items
		.map((item, index) => generateItem(item, index, baseUrl, token))
		.join('\n')

	return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" title="RSS Feed" type="application/rss+xml" />
    <title>${title}</title>
    <link>${link}</link>
    <description>${description}</description>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>${language}</language>
    <generator>MediaRSS</generator>
    
    <!-- iTunes/Apple Podcasts metadata -->
    <itunes:title>${title}</itunes:title>
    ${author ? `<itunes:author>${author}</itunes:author>` : ''}
    <itunes:summary>${description}</itunes:summary>
    <itunes:explicit>${explicit}</itunes:explicit>
    ${category ? `<itunes:category text="${category}" />` : ''}
    <itunes:image href="${imageUrl}" />
    ${
			ownerName || ownerEmail
				? `
    <itunes:owner>
      ${ownerName ? `<itunes:name>${ownerName}</itunes:name>` : ''}
      ${ownerEmail ? `<itunes:email>${ownerEmail}</itunes:email>` : ''}
    </itunes:owner>`
				: ''
		}
    
    <!-- Google Play metadata -->
    ${author ? `<googleplay:author>${author}</googleplay:author>` : ''}
    <googleplay:description>${description}</googleplay:description>
    <googleplay:explicit>${explicit}</googleplay:explicit>
    <googleplay:image href="${imageUrl}" />

    <!-- Channel image -->
    <image>
      <url>${imageUrl}</url>
      <title>${title}</title>
      <link>${link}</link>
    </image>

${itemsXml}
  </channel>
</rss>`
}
