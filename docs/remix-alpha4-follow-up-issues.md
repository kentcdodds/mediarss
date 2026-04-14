# Remix alpha.4 follow-up ideas

These are candidate GitHub issues derived from the alpha.4 package release
review.

## Suggested issues

1. Adopt `remix/component` frame navigation for admin SPA links and modal/detail
   flows.
   - Why: alpha.4 adds built-in navigation interception, `navigate()`, `link()`,
     and named frame targeting.
2. Evaluate replacing custom admin History router with Remix frame-aware
   navigation/runtime APIs.
   - Why: current router duplicates behavior now shipped by `remix/component`.
3. Add browser-origin protection to admin and OAuth endpoints with
   `remix/cop-middleware`.
   - Why: alpha.4 adds fetch-metadata/origin-aware request filtering for browser
     traffic.
4. Add token-backed CSRF protection for admin mutations with
   `remix/csrf-middleware`.
   - Why: admin API writes currently rely on same-origin assumptions.
5. Evaluate `remix/cors-middleware` for MCP/OAuth endpoints to replace local
   CORS wrappers.
   - Why: alpha.4 ships a maintained CORS middleware package.
6. Review `remix/auth` and `remix/auth-middleware` for future admin
   authentication instead of edge-only protection.
   - Why: alpha.4 adds first-party auth packages.
7. Explore `remix/data-table` migrations for replacing bespoke SQL migration
   plumbing.
   - Why: alpha.4 ships a first-class migration system with dry-run/status
     support.
8. Evaluate table lifecycle hooks in `remix/data-table` for feed/token
   validation and read shaping.
   - Why: alpha.4 adds `beforeWrite`, `afterWrite`, `beforeDelete`,
     `afterDelete`, and `afterRead`.
9. Add runtime error listeners around `remix/component` app startup for
   admin/client hydration visibility.
   - Why: alpha.4 forwards runtime and frame reload errors to the top-level app
     target.
