import { invariant } from '@epic-web/invariant'
import { resolveMediaPath } from '#app/config/env.ts'
import type { DirectoryFeed, Feed } from '#app/db/types.ts'
import { formatItunesDuration, formatRssDate } from './format.ts'
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
	/** The admin URL for managing this feed */
	adminUrl: string
	/**
	 * The sort fields used to order items in this feed.
	 * When sorting is NOT by publication date, episode titles will be prefixed
	 * with numbers (e.g., "001. Title") to enable title-based sorting in podcast
	 * clients while preserving the actual publication dates.
	 */
	sortFields: string
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
 * Check if the sort fields indicate sorting by publication date.
 * When sorting by publication date, no title numbering is needed.
 * For any other sort order, titles are prefixed with episode numbers.
 */
export function isSortingByPubDate(sortFields: string): boolean {
	const pubDateFields = ['pubDate', 'publicationDate']
	return pubDateFields.some(
		(field) => sortFields === field || sortFields.startsWith(`${field},`),
	)
}

/**
 * Format an episode number prefix for title-based sorting in podcast clients.
 *
 * BACKGROUND: Podcast clients like PocketCasts support sorting by title, which
 * allows us to maintain a specific episode order by prefixing titles with
 * zero-padded numbers. This is more sensible than synthetic publication dates
 * because it preserves the actual publication dates while still enabling
 * proper ordering.
 *
 * The number is zero-padded based on the total number of items to ensure
 * proper lexicographic sorting (e.g., "001" sorts before "010" before "100").
 *
 * @param index - The 0-based index of the item in the sorted feed
 * @param totalItems - The total number of items in the feed (for padding calculation)
 * @returns A string prefix like "001. " or "0001. "
 */
export function formatEpisodeNumber(index: number, totalItems: number): string {
	// Calculate the number of digits needed based on total items
	// e.g., 100 items needs 3 digits (001-100), 1000 items needs 4 digits (0001-1000)
	const digits = Math.max(1, Math.ceil(Math.log10(totalItems + 1)))
	const episodeNumber = (index + 1).toString().padStart(digits, '0')
	return `${episodeNumber}. `
}

/**
 * Generate a fallback publication date for items without one.
 * Uses a base date of 1900-01-01 and increments by 1 minute per item index.
 * This ensures sort order is preserved when podcast clients sort by pubDate.
 *
 * Note: This is only used when sorting by pubDate but an item is missing its
 * publication date metadata. For non-pubDate sorting, use getSyntheticPubDate.
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
 * Uses format: /art/:token/:rootName/:relativePath?v={cacheVersion}
 */
function getArtworkUrl(
	baseUrl: string,
	token: string,
	filePath: string,
	cacheVersion: number,
): string {
	const resolved = resolveMediaPath(filePath)
	invariant(
		resolved,
		`File "${filePath}" is not within any configured media root. Check MEDIA_PATHS configuration.`,
	)
	const encodedRelativePath = encodeURIComponent(resolved.relativePath)
	return `${baseUrl}/art/${token}/${resolved.root.name}/${encodedRelativePath}?v=${cacheVersion}`
}

/**
 * Build the description for an RSS item.
 * Returns the description as-is, or an empty string if not provided.
 */
function buildDescription(description: string | null | undefined): string {
	return description || ''
}

/**
 * Generate a single RSS item element.
 *
 * @param item - The media file to generate an item for
 * @param index - The 0-based index of this item in the feed
 * @param totalItems - Total number of items in the feed (for episode number padding)
 * @param baseUrl - The base URL for the server
 * @param token - The token used to access this feed
 * @param cacheVersion - Cache version for artwork URLs
 * @param useTitleNumbering - If true, prefix titles with episode numbers for
 *                            title-based sorting in podcast clients.
 */
function generateItem(
	item: MediaFile,
	index: number,
	totalItems: number,
	baseUrl: string,
	token: string,
	cacheVersion: number,
	useTitleNumbering: boolean,
): string {
	const itemId = generateItemId(item)

	// Always use the item's actual publication date, or a fallback if missing
	const pubDate = item.publicationDate
		? formatRssDate(item.publicationDate)
		: formatRssDate(getFallbackDate(index))

	// When not sorting by pubDate, prefix titles with episode numbers
	// so podcast clients can sort by title to maintain the intended order
	const titlePrefix = useTitleNumbering
		? formatEpisodeNumber(index, totalItems)
		: ''
	const title = `${titlePrefix}${item.title}`

	const description = buildDescription(item.description)

	const mediaUrl = getMediaUrl(baseUrl, token, item.path)
	const artworkUrl = getArtworkUrl(baseUrl, token, item.path, cacheVersion)
	const duration = formatItunesDuration(item.duration)

	return `    <item>
      <guid isPermaLink="false">${escapeXml(itemId)}</guid>
      <title>${escapeXml(title)}</title>
      <description>${cdata(description)}</description>
      <pubDate>${pubDate}</pubDate>
      ${item.author ? `<author>${escapeXml(item.author)}</author>` : ''}
      <content:encoded>${cdata(description)}</content:encoded>
      <enclosure url="${escapeXml(mediaUrl)}" length="${item.sizeBytes}" type="${escapeXml(item.mimeType)}" />
      <itunes:title>${escapeXml(title)}</itunes:title>
      ${item.author ? `<itunes:author>${escapeXml(item.author)}</itunes:author>` : ''}
      ${duration ? `<itunes:duration>${duration}</itunes:duration>` : ''}
      <itunes:image href="${escapeXml(artworkUrl)}" />
      <itunes:summary>${cdata(description)}</itunes:summary>
      <itunes:subtitle>${cdata(description?.slice(0, 255))}</itunes:subtitle>
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
 *
 * When the feed is sorted by something other than publication date (e.g., track
 * number, filename, or manual position), episode titles are prefixed with numbers
 * (e.g., "001. Title", "002. Title") to enable title-based sorting in podcast
 * clients like PocketCasts. This preserves the actual publication dates while
 * still maintaining the intended episode order.
 */
export function generateRssFeed(options: RSSGeneratorOptions): string {
	const { feed, items, baseUrl, token, feedUrl, adminUrl, sortFields } = options

	// Determine if we need to use title numbering for ordering.
	// When sorting by pubDate, no numbering is needed as clients will sort correctly.
	// For any other sort order, prefix titles with episode numbers so clients
	// can sort by title to maintain the intended order.
	const useTitleNumbering = !isSortingByPubDate(sortFields)

	// Get feed metadata
	const title = escapeXml(feed.name)
	// Description falls back to subtitle, then to a generic message
	const description = cdata(
		feed.description || feed.subtitle || `Podcast feed: ${feed.name}`,
	)
	// Subtitle is a short tagline (max 255 chars) shown in podcast apps
	// Fall back to truncated description if no subtitle is set
	const subtitle = cdata(
		feed.subtitle ||
			(feed.description ? feed.description.slice(0, 255) : feed.name),
	)
	const link = escapeXml(feed.link || adminUrl)
	const cacheVersion = feed.updatedAt
	const imageUrl = feed.imageUrl
		? escapeXml(feed.imageUrl)
		: `${baseUrl}/art/${token}/feed?v=${cacheVersion}`
	const author = escapeXml(feed.author)
	const ownerName = escapeXml(feed.ownerName || feed.author)
	const ownerEmail = escapeXml(feed.ownerEmail)
	const language = escapeXml(feed.language || 'en')
	const explicit = escapeXml(feed.explicit || 'no')
	const category = escapeXml(feed.category)
	const copyright = escapeXml(feed.copyright)
	// Feed type: "episodic" (default) or "serial" - affects episode ordering in apps
	const feedType = escapeXml(feed.feedType || 'episodic')

	const lastBuildDate = formatRssDate(new Date())

	// Generate items
	const totalItems = items.length
	const itemsXml = items
		.map((item, index) =>
			generateItem(
				item,
				index,
				totalItems,
				baseUrl,
				token,
				cacheVersion,
				useTitleNumbering,
			),
		)
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
    ${copyright ? `<copyright>${copyright}</copyright>` : ''}
    
    <!-- iTunes/Apple Podcasts metadata -->
    <itunes:title>${title}</itunes:title>
    <itunes:subtitle>${subtitle}</itunes:subtitle>
    ${author ? `<itunes:author>${author}</itunes:author>` : ''}
    <itunes:summary>${description}</itunes:summary>
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:type>${feedType}</itunes:type>
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
