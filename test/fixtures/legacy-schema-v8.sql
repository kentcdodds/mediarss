-- Schema of a database created by the legacy app/db/migrations.ts at version 8.
-- Generated from sqlite_master; used by the legacy-adoption test.

CREATE TABLE "authorization_codes" ( code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', code_challenge TEXT NOT NULL, code_challenge_method TEXT NOT NULL DEFAULT 'S256', expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE TABLE client_metadata_cache ( client_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, cached_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER NOT NULL );

CREATE TABLE curated_feed_tokens ( token TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES curated_feeds(id) ON DELETE CASCADE, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()), last_used_at INTEGER, revoked_at INTEGER );

CREATE TABLE curated_feeds ( id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_fields TEXT NOT NULL DEFAULT 'position', sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')), author TEXT, owner_name TEXT, owner_email TEXT, language TEXT NOT NULL DEFAULT 'en', explicit TEXT NOT NULL DEFAULT 'no', category TEXT, link TEXT, overrides TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()) , subtitle TEXT, copyright TEXT, feed_type TEXT CHECK (feed_type IN ('episodic', 'serial')));

CREATE TABLE directory_feed_tokens ( token TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES directory_feeds(id) ON DELETE CASCADE, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()), last_used_at INTEGER, revoked_at INTEGER );

CREATE TABLE directory_feeds ( id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', directory_paths TEXT NOT NULL, sort_fields TEXT NOT NULL DEFAULT 'filename', sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')), author TEXT, owner_name TEXT, owner_email TEXT, language TEXT NOT NULL DEFAULT 'en', explicit TEXT NOT NULL DEFAULT 'no', category TEXT, link TEXT, filter_in TEXT, filter_out TEXT, overrides TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()) , subtitle TEXT, copyright TEXT, feed_type TEXT CHECK (feed_type IN ('episodic', 'serial')));

CREATE TABLE feed_analytics_events ( id TEXT PRIMARY KEY, event_type TEXT NOT NULL CHECK (event_type IN ('rss_fetch', 'media_request')), feed_id TEXT NOT NULL, feed_type TEXT NOT NULL CHECK (feed_type IN ('directory', 'curated')), token TEXT NOT NULL, media_root TEXT, relative_path TEXT, is_download_start INTEGER NOT NULL DEFAULT 0, bytes_served INTEGER, status_code INTEGER NOT NULL, client_fingerprint TEXT, client_name TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE TABLE feed_items ( id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES curated_feeds(id) ON DELETE CASCADE, media_root TEXT NOT NULL, relative_path TEXT NOT NULL, position REAL, added_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(feed_id, media_root, relative_path) );

CREATE TABLE oauth_clients ( id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE TABLE oauth_refresh_tokens ( token TEXT PRIMARY KEY, family_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE TABLE oauth_signing_keys ( id TEXT PRIMARY KEY, public_key_jwk TEXT NOT NULL, private_key_jwk TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE TABLE schema_versions ( version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch()) );

CREATE INDEX idx_authorization_codes_client_id ON authorization_codes(client_id);

CREATE INDEX idx_authorization_codes_expires_at ON authorization_codes(expires_at);

CREATE INDEX idx_client_metadata_cache_expires_at ON client_metadata_cache(expires_at);

CREATE INDEX idx_curated_feed_tokens_feed_id ON curated_feed_tokens(feed_id);

CREATE INDEX idx_directory_feed_tokens_feed_id ON directory_feed_tokens(feed_id);

CREATE INDEX idx_feed_analytics_events_event_type_created_at ON feed_analytics_events(event_type, created_at);

CREATE INDEX idx_feed_analytics_events_feed_id_created_at ON feed_analytics_events(feed_id, created_at);

CREATE INDEX idx_feed_analytics_events_media_path_created_at ON feed_analytics_events(media_root, relative_path, created_at);

CREATE INDEX idx_feed_analytics_events_token_created_at ON feed_analytics_events(token, created_at);

CREATE INDEX idx_feed_items_feed_id ON feed_items(feed_id);

CREATE INDEX idx_oauth_refresh_tokens_client_id ON oauth_refresh_tokens(client_id);

CREATE INDEX idx_oauth_refresh_tokens_expires_at ON oauth_refresh_tokens(expires_at);

CREATE INDEX idx_oauth_refresh_tokens_family_id ON oauth_refresh_tokens(family_id);

INSERT INTO schema_versions (version, name, applied_at) VALUES (1, 'initial_schema', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (2, 'add_feed_properties', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (3, 'add_oauth_tables', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (4, 'add_client_metadata_cache', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (5, 'add_feed_analytics_events', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (6, 'drop_feed_image_url_columns', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (7, 'add_oauth_refresh_tokens', 1789064341);
INSERT INTO schema_versions (version, name, applied_at) VALUES (8, 'drop_authorization_codes_client_fk', 1789064341);
