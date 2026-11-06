# Authentication session behaviour

Customer and admin sessions are stored separately in PostgreSQL (`customer_sessions` and `admin_sessions`). Authentication cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, and have no `Max-Age` or `Expires` attribute. The customer and admin cookies are independent, and each cookie is scoped by a per-tab identifier. The bearer session token is never put in a URL, browser storage, or JavaScript-readable state.

The tab identifier is a random, non-authenticating value kept in `sessionStorage` so it survives refreshes and same-tab navigation. API requests send it in `X-Tab-Session`; the server checks it against the server-side session record before authorizing a request. Where `BroadcastChannel` is available, a short-lived cross-tab probe detects an active tab whose `sessionStorage` was cloned by `window.open` and assigns the new tab a different identifier. Without that API, or if the original tab is suspended and cannot answer the probe, cloned tab storage cannot be distinguished reliably.

## Expiration settings

All values are whole numbers:

| Environment variable | Default | Allowed range |
| --- | ---: | ---: |
| `CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES` | 30 | 1–1440 |
| `CUSTOMER_SESSION_MAX_LIFETIME_HOURS` | 8 | 1–168 |
| `ADMIN_SESSION_IDLE_TIMEOUT_MINUTES` | 30 | 1–1440 |
| `ADMIN_SESSION_MAX_LIFETIME_HOURS` | 8 | 1–168 |

Invalid values stop session-service initialization rather than silently changing the requested policy. The idle deadline advances only when a user interaction is followed by an API request marked as user activity. Background refreshes and ordinary API reads do not extend it. Every protected request also checks the idle and absolute deadlines in PostgreSQL, so hiding the dashboard in the browser is not the authorization boundary.

## Tab closing and multiple tabs

Opening a fresh tab normally creates a different `sessionStorage` identifier and therefore cannot use the existing tab's server-side session. Each tab can sign in independently; customer sign-out revokes only that tab's customer session, and admin sign-out revokes only that tab's admin session.

Browsers do not provide a reliable tab-close notification. This implementation deliberately does not revoke a session from `beforeunload` or `pagehide`, because those events also occur during navigation and may not run on abrupt closure. Closing a tab therefore ends access from that tab, but the server-side session remains until its idle or absolute timeout, or explicit sign-out. Browser session-cookie restoration and cloned `sessionStorage` can also vary by browser. Strict, guaranteed revocation at the exact moment a tab closes is not claimed.

If PostgreSQL is unavailable or session lookup fails, protected API requests fail closed and the frontend hides authenticated data. Existing sessions without the new tab and idle-expiry fields are rejected after the schema migration and require sign-in again.
