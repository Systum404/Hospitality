# AAZIRA production edge contract

AAZIRA's intended production topology uses one public HTTPS origin. The edge must route `/api/*` to the Express service and serve the built frontend for all other paths. Direct requests to `/qr/*` must fall back to `index.html`; `/api/*` must never use the SPA fallback.

The repository is provider-neutral: it contains the Express service, the Vite frontend, and a static-host SPA fallback marker, but no deployable TLS terminator or reverse-proxy configuration. An infrastructure deployment must implement the rules below and be verified on the real edge before release.

## Required environment

- Set `NODE_ENV=production` for the backend process.
- Set `DATABASE_URL` to the production PostgreSQL connection string. It has no production fallback.
- Set `AUTH_SECRET` to a deployment secret of at least 32 characters. Never expose it to the frontend build.
- `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_TOKEN_TTL_SECONDS`, and `AUTH_REMEMBER_TTL_SECONDS` may retain their documented defaults or be explicitly configured. Invalid TTLs fail startup.
- Set `CORS_ORIGIN` to the exact HTTPS public origin(s), comma-separated. Wildcards and origins containing paths are rejected. Credentialed staff APIs must never use `*`.
- Keep `VITE_API_BASE_URL` unset for the intended same-origin build. If deployment intentionally separates origins, set it to the exact HTTPS API origin and include the frontend origin in `CORS_ORIGIN`.
- Set `TRUST_PROXY` only when a known reverse proxy directly connects to Express. Supply the proxy's exact IP address or CIDR range (comma-separated for multiple trusted proxies). When unset, Express ignores forwarded client-IP headers. Never configure blanket proxy trust.
- Set `PORT` to the internal Express listener port when the platform does not provide it. The default is `4000`.

Secrets belong only in the deployment secret store. Do not copy a production database URL, authentication secret, private key, QR capability, or provisioning password into any `VITE_*` variable; Vite variables are public build-time data.

## HTTPS and routing

TLS terminates at the production edge; Express does not terminate TLS. The edge must redirect HTTP to HTTPS before serving the SPA or forwarding `/api`. Production `CORS_ORIGIN` values must use HTTPS. Authentication cookies remain `Secure`, `HttpOnly`, and `SameSite=Strict` in production. Preserve Helmet's HSTS response header on API responses.

Forward the original scheme and client address only from the trusted edge. Configure `TRUST_PROXY` to match the direct proxy hop(s), not the public internet and not a blanket boolean. The edge must replace, rather than append untrusted client-supplied forwarding headers. When no proxy range is known, leave `TRUST_PROXY` unset and treat production client-IP/rate-limit verification as incomplete.

Required routing order:

1. `/api/*` -> Express without caching.
2. Existing static asset -> the asset, with content-hashed assets eligible for immutable caching.
3. `/qr/*` and other client routes -> `index.html` with no-cache/revalidation behavior.

Forward the original method and body for every API method, including `POST`, `PUT`, `PATCH`, and `DELETE`. Preserve Express status codes, JSON bodies, CORS headers, `Set-Cookie`, and security/cache headers. Do not use the static host's catch-all `_redirects` rule as the unified edge rule: `/api/*` must have higher routing precedence and must never return `index.html`.

Public QR API responses are explicitly emitted with `Cache-Control: no-store`; the edge must not override that header. Room capability responses and public order responses must never be cached. Do not publicly cache authenticated staff API responses. Serve `index.html` with `no-cache` (or an equivalent revalidation policy), and cache only content-hashed JS/CSS/image assets as immutable.

## Frontend security headers

The static host must emit `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, frame protection (`Content-Security-Policy: frame-ancestors 'self'` and/or `X-Frame-Options: SAMEORIGIN`), and HSTS over HTTPS. A complete CSP must use the actual deployed asset and menu-image origins. Do not deploy wildcard `script-src` or `img-src`; the exact external image allow-list remains a deployment prerequisite because menu image URLs are configurable data.

At minimum, same-origin scripts, styles, fonts, API connections, and local/data images must be allowed. Add only the exact production image hosts actually used by hotel menu data. Validate the final policy against the built customer and staff UI before enabling enforcement.

The current bundle uses same-origin module scripts and styles, local assets, CSS data-image masks, inline React style attributes, and API `fetch` calls. A candidate policy therefore needs at least `default-src 'self'`, `script-src 'self'`, an appropriately tested style policy for current inline styles, `img-src 'self' data:` plus the exact configured menu-image origins, `connect-src 'self'` (plus the exact API origin only for split-origin deployment), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'`. Treat this as a starting contract, not a copy-paste enforcement policy; validate it against the actual deployed asset/image origins.

The frontend static host must also emit `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, frame protection, and HSTS on HTTPS responses. Express already emits Helmet defaults for API responses; avoid conflicting edge overrides.

## Build and process contract

Build the frontend with `npm run build --prefix client` and deploy `client/dist` as the static artifact. Start the backend with `npm start` under a supervisor that restarts failed processes and supports graceful `SIGTERM`. Keep `VITE_API_BASE_URL` unset for same-origin production so every role and the public QR client calls `/api` on the public origin. The edge's database network policy must permit the backend—not the browser—to reach PostgreSQL.

## Deployment verification

Before production release, verify on the real edge that spoofed `X-Forwarded-For` values do not alter `req.ip` unless sent through a configured trusted proxy, `/api/health` reaches Express, direct refresh of `/qr/:token` returns the SPA, API 404 responses are not replaced by `index.html`, all API methods preserve bodies and status codes, HTTP redirects to HTTPS, public QR responses are not cached, exact-origin CORS succeeds, and unlisted origins receive no credentialed CORS access.

Also verify a real public table order, room capability and room order, idempotent retry, completed-order immutability, staff login/session/logout for every role, and Manager capability issuance. These checks require the deployed TLS/proxy/static-host path; direct localhost evidence is not a substitute.
