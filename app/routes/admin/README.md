# Admin server rendering conventions

Admin pages are server-first. Every admin URL should return useful HTML from a
plain `GET`, and every browser mutation should work as a native form submission
before any client-side behavior is added.

## Rules

- Render admin pages through `renderAdminPage(...)` from `admin-utils.tsx`.
- Submit browser mutations with `<form method="post">` and `FormData`.
- Include an `_action` field for the server action switch.
- Return `redirect303(...)` after successful mutations.
- Re-render HTML with an error status for validation failures.
- Do not make JSON `fetch()` the primary browser mutation path.

JSON endpoints can still exist for external clients or optional progressive
enhancement, but they must not be the only way a browser workflow works.

## Revalidation

The baseline revalidation model is POST-redirect-GET:

1. The form posts to the server.
2. The server mutates state.
3. The server returns `303` to the page that should be fresh.
4. The browser follows with a new `GET`.

That is the source of truth and works with JavaScript disabled.

When adding JavaScript enhancements, prefer Remix Frames for partial updates.
Frame-based enhancement should submit the same form data to the same server
action, then reload the relevant frame with `handle.frame.reload()` or
`handle.frames.get(name)?.reload()`. Do not add a parallel JSON state API unless
the UI is genuinely a small polling widget or external API consumer.

The admin shell uses `enhanceAdminForms(...)` to progressively enhance existing
forms. The enhancer prevents the default browser navigation, posts the same
`FormData`, follows the server's redirect target, and replaces the admin frame
with the fresh server-rendered HTML. Do not add client-only mutation APIs for
admin forms; make the plain form work first and let the enhancer reuse it.

## Utilities

- `renderAdminPage(...)` wraps the shared admin shell and document.
- `getRequiredString(...)`, `getOptionalString(...)`, `getAllStringValues(...)`,
  and `getLineValues(...)` keep form parsing consistent.
- `redirect303(...)` enforces POST-redirect-GET.
- `admin-styles.ts` owns shared server-rendered admin styles so new pages stay
  visually aligned with the existing admin UI.
- `enhanceAdminForms(...)` adds optional frame-based form enhancement without
  changing the server contract.
