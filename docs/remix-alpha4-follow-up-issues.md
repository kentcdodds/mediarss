# Remix v3 follow-up ideas

These are candidate GitHub issues derived from the Remix v3 package release
review.

## Suggested issues

1. Adopt `remix/ui` frame navigation for admin SPA links and modal/detail flows.
   - Why: Remix v3 includes built-in navigation interception, `navigate()`,
     `link()`, and named frame targeting.
2. Evaluate replacing custom admin History router with Remix frame-aware
   navigation/runtime APIs.
   - Why: current router duplicates behavior now shipped by `remix/ui`.
3. Add browser-origin protection to admin and OAuth endpoints with
   `remix/cop-middleware`.
   - Why: Remix v3 adds fetch-metadata/origin-aware request filtering for
     browser traffic.
4. Add token-backed CSRF protection for admin mutations with
   `remix/csrf-middleware`.
   - Why: admin API writes currently rely on same-origin assumptions.
5. Evaluate `remix/cors-middleware` for MCP/OAuth endpoints to replace local
   CORS wrappers.
   - Why: Remix v3 ships a maintained CORS middleware package.
6. Review `remix/auth` and `remix/auth-middleware` for future admin
   authentication instead of edge-only protection.
   - Why: Remix v3 adds first-party auth packages.
7. Explore `remix/data-table` migrations for replacing bespoke SQL migration
   plumbing.
   - Why: Remix v3 ships a first-class migration system with dry-run/status
     support.
8. Evaluate table lifecycle hooks in `remix/data-table` for feed/token
   validation and read shaping.
   - Why: Remix v3 adds `beforeWrite`, `afterWrite`, `beforeDelete`,
     `afterDelete`, and `afterRead`.
9. Add runtime error listeners around `remix/ui` app startup for admin/client
   hydration visibility.
   - Why: Remix v3 forwards runtime and frame reload errors to the top-level app
     target.
