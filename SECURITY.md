# Internal PIN gate and PWA

The webapp requires the store PIN before opening private pages. In Next.js 16 the root `proxy.ts` replaces the deprecated `middleware.ts` convention. It redirects unauthenticated page requests to `/login` and returns HTTP 401 for protected APIs. Public exceptions are the login/logout endpoints, login page, manifest, service worker and named app icons/static framework assets. Unknown paths and APIs are protected too.

Set `POS_INTERNAL_PIN` in Vercel's server environment and redeploy to choose the store PIN. The owner-requested fallback when it is unset/empty is `44448888`. Never use `NEXT_PUBLIC_` for PINs or signing secrets. Optionally set a long random `POS_SESSION_SECRET` for an independent signing secret. All instances must use the same values. Changing the PIN or signing secret invalidates existing device cookies.

Successful login issues an HMAC-SHA256 signed `sanghai_pos_session` cookie with a random nonce and fixed 90-day expiry. It is HttpOnly, SameSite=Lax, scoped to `/` and Secure in production/HTTPS. The PIN is never returned to the browser or stored in the cookie/localStorage. Signature and expiry are verified before private routes. Bad PINs return 401. Same-origin checks reject cross-site login/logout POSTs. Login uses a best-effort per-instance failure throttle (10 failures per 15 minutes); this is not a globally coordinated rate limit across Vercel instances.

“Khóa phiên” clears the device cookie and local receipt/settings caches, replaces the page with `/login`, and signals other open tabs to close their session. It is disabled during checkout. Browser back/forward restores reload the page through the server gate; focused tabs and periodic session checks close expired/invalid sessions. Logout does not remove financial records from Supabase. As with a typical stateless signed session, deleting the local cookie does not revoke a separately copied cookie; PIN/secret rotation invalidates all copies.

## Supabase access boundary

This change protects the Next.js webapp and its APIs. The current POS still calls Supabase directly using its existing public/publishable key, and the existing database policies grant anonymous internal-app access. The PIN cookie is **not** a Supabase identity and does **not** change those policies. Anyone possessing that public key may still have direct database/Storage access allowed by RLS, independently of the webapp gate. Public product images also remain public.

Therefore this gate alone does not make the underlying database private. Restricting direct Supabase access requires a separate authenticated database access design/RLS migration (for example a server-only data gateway and removal of anonymous grants/policies). No service-role key is added to browser code, and this update deliberately makes no database permission changes that could break the existing store. Review that boundary before treating the database itself as internal-only.

## Install on phones

Open the HTTPS site, add it to the home screen/install it, then launch from the new Sanghai POS icon. Android/Chromium launches in standalone mode; iOS uses Add to Home Screen and the configured Apple icon/status bar. An ordinary browser tab retains its browser chrome. The manifest uses fixed app name/colors, `/` start/scope and 192px/512px PNG plus SVG icons. Layout provides mobile viewport and Apple webapp metadata.

The service worker caches only the four public app icons. Navigations always use the network and are never cached; APIs, PINs, orders, product data and authenticated HTML are not cached by it. Without network it shows a reconnect screen, not an offline POS or queued payment flow. Existing financial write/retry behavior is unchanged.

Validation uses isolated unit/SQL tests and browser requests against the local test server. Browser business fixtures sign in using a dedicated test PIN/signing secret set only on the Playwright server; no production database sales are created.
