# 0003: Public feed, media, and art URLs are a contract

Status: accepted Date: 2026-10-23

## Decision

Do not change the shape of `/feed/:token`, `/media/:token/*path`, or
`/art/:token/*path`, how tokens are generated or validated, or the GUIDs and
enclosure URLs in RSS output, without Kent's approval. These routes are high
risk in the ship loop.

## Why

Podcast apps store these URLs when someone subscribes and never re-discover
them. A changed path, token rule, or item GUID silently breaks subscriptions or
re-downloads every episode, and there is no way to notify subscribers.

## Revisit if

Kent decides to migrate subscribers deliberately (for example, a versioned route
that keeps the old one working).
