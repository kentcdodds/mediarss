# 0005: Admin auth lives at Cloudflare Access

Status: accepted Date: 2026-10-23

## Decision

Do not add app-level login to `/admin`, and do not change routing or headers in
a way that would expose `/admin` without Cloudflare Access in front of it. Admin
pages and `/admin/api/*` trust that the edge has authenticated the request. MCP
clients authenticate separately with OAuth (`app/oauth`, `/mcp`); changes there
are high risk.

## Why

Podcast apps need unauthenticated, token-based access to feeds and media, while
the admin UI is for one person. Cloudflare Access gives SSO/OTP at the edge with
no passwords in the app. See "Securing the Admin Dashboard" in the README.

## Revisit if

MediaRSS gets users who self-host without Cloudflare Access, or the admin needs
per-user permissions.
