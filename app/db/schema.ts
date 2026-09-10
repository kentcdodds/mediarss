import { column as c, table } from 'remix/data-table'

export const directoryFeedsTable = table({
	name: 'directory_feeds',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		name: c.text(),
		description: c.text(),
		subtitle: c.text().nullable(),
		directory_paths: c.text(),
		sort_fields: c.text(),
		sort_order: c.enum(['asc', 'desc'] as const),
		author: c.text().nullable(),
		owner_name: c.text().nullable(),
		owner_email: c.text().nullable(),
		language: c.text(),
		explicit: c.text(),
		category: c.text().nullable(),
		link: c.text().nullable(),
		copyright: c.text().nullable(),
		feed_type: c.enum(['episodic', 'serial'] as const).nullable(),
		filter_in: c.text().nullable(),
		filter_out: c.text().nullable(),
		overrides: c.text().nullable(),
		created_at: c.integer(),
		updated_at: c.integer(),
	},
})

export const curatedFeedsTable = table({
	name: 'curated_feeds',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		name: c.text(),
		description: c.text(),
		subtitle: c.text().nullable(),
		sort_fields: c.text(),
		sort_order: c.enum(['asc', 'desc'] as const),
		author: c.text().nullable(),
		owner_name: c.text().nullable(),
		owner_email: c.text().nullable(),
		language: c.text(),
		explicit: c.text(),
		category: c.text().nullable(),
		link: c.text().nullable(),
		copyright: c.text().nullable(),
		feed_type: c.enum(['episodic', 'serial'] as const).nullable(),
		overrides: c.text().nullable(),
		created_at: c.integer(),
		updated_at: c.integer(),
	},
})

export const feedItemsTable = table({
	name: 'feed_items',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		feed_id: c.text(),
		media_root: c.text(),
		relative_path: c.text(),
		position: c.integer().nullable(),
		added_at: c.integer(),
	},
})

export const directoryFeedTokensTable = table({
	name: 'directory_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: c.text(),
		feed_id: c.text(),
		label: c.text(),
		created_at: c.integer(),
		last_used_at: c.integer().nullable(),
		revoked_at: c.integer().nullable(),
	},
})

export const curatedFeedTokensTable = table({
	name: 'curated_feed_tokens',
	primaryKey: 'token',
	columns: {
		token: c.text(),
		feed_id: c.text(),
		label: c.text(),
		created_at: c.integer(),
		last_used_at: c.integer().nullable(),
		revoked_at: c.integer().nullable(),
	},
})

export const feedAnalyticsEventsTable = table({
	name: 'feed_analytics_events',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		event_type: c.enum(['rss_fetch', 'media_request'] as const),
		feed_id: c.text(),
		feed_type: c.enum(['directory', 'curated'] as const),
		token: c.text(),
		media_root: c.text().nullable(),
		relative_path: c.text().nullable(),
		is_download_start: c.integer(),
		bytes_served: c.integer().nullable(),
		status_code: c.integer(),
		client_fingerprint: c.text().nullable(),
		client_name: c.text().nullable(),
		created_at: c.integer(),
	},
})

export const oauthClientsTable = table({
	name: 'oauth_clients',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		name: c.text(),
		redirect_uris: c.text(),
		created_at: c.integer(),
	},
})

export const authorizationCodesTable = table({
	name: 'authorization_codes',
	primaryKey: 'code',
	columns: {
		code: c.text(),
		client_id: c.text(),
		redirect_uri: c.text(),
		scope: c.text(),
		code_challenge: c.text(),
		code_challenge_method: c.text(),
		expires_at: c.integer(),
		used_at: c.integer().nullable(),
		created_at: c.integer(),
	},
})

export const oauthRefreshTokensTable = table({
	name: 'oauth_refresh_tokens',
	primaryKey: 'token',
	columns: {
		token: c.text(),
		family_id: c.text(),
		client_id: c.text(),
		scope: c.text(),
		expires_at: c.integer(),
		used_at: c.integer().nullable(),
		created_at: c.integer(),
	},
})

export const oauthSigningKeysTable = table({
	name: 'oauth_signing_keys',
	primaryKey: 'id',
	columns: {
		id: c.text(),
		public_key_jwk: c.text(),
		private_key_jwk: c.text(),
		created_at: c.integer(),
	},
})

export const clientMetadataCacheTable = table({
	name: 'client_metadata_cache',
	primaryKey: 'client_id',
	columns: {
		client_id: c.text(),
		metadata_json: c.text(),
		cached_at: c.integer(),
		expires_at: c.integer(),
	},
})
