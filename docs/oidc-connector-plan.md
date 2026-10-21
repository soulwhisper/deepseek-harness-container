# Plan: generic OIDC connector for the local SSO plugin

Status: proposed, not implemented. The current image ships a trusted-proxy
header gate, not an OIDC client. This plan keeps the existing mode working and
describes the additional work required to make the local plugin a generic
OpenID Connect Relying Party (RP).

## Current boundary

`@soulwhisper/dsh-sso` currently:

- accepts exactly one `x-authentik-uid` from a real peer in
  `DSH_SSO_TRUSTED_PROXY_CIDRS`;
- requires the UID to be in `DSH_SSO_ALLOWED_UIDS`;
- uses DSH's native `Connection.authorizeIndex`/`requestRejection` to mint the
  native browser cookie;
- rejects missing, duplicate, malformed or unknown identity and never restores
  an unguarded listener.

OAuth/OIDC authorization, MFA, logout and session policy are delegated to the
verified edge. Replacing that edge with an in-process RP changes the threat
model and must not be presented as a configuration-only feature.

## Decision

Do not embed OIDC into the current `0.2.1-rc.2` line as an unvalidated default.
Use a two-stage path:

1. **Generic trusted-header mode (low risk).** Keep the edge as the OIDC client,
   but make the header name and subject policy configurable. Define a strict
   contract for any edge that injects a stable subject. This covers Keycloak,
   Authentik, oauth2-proxy and similar deployments without adding browser-facing
   auth routes.
2. **Optional embedded OIDC RP (higher risk).** Add a separate mode with a
   complete authorization-code + PKCE flow, validated ID tokens, its own
   browser session and protected auth routes. It remains single-owner and does
   not introduce per-user DSH data isolation.

Embedded OIDC is optional. The mandatory raw gate remains in both modes.

## Proposed configuration (not implemented)

```text
DSH_SSO_MODE=trusted-header | oidc
DSH_SSO_HEADER=x-authentik-uid          # trusted-header mode
DSH_SSO_SUBJECT_PATTERN=^[A-Za-z0-9_-]{1,256}$
DSH_SSO_ALLOWED_UIDS=<subject allowlist> # still shared-owner allowlist

DSH_SSO_OIDC_ISSUER=https://idp.example/
DSH_SSO_OIDC_CLIENT_ID=dsh
DSH_SSO_OIDC_CLIENT_SECRET_FILE=/run/secrets/dsh-oidc-client-secret
DSH_SSO_OIDC_REDIRECT_URI=https://dsh.example/auth/callback
DSH_SSO_OIDC_SCOPES=openid profile email
DSH_SSO_OIDC_ALLOWED_SUBJECTS=<stable sub allowlist>
DSH_SSO_OIDC_ALLOWED_GROUPS=<optional group allowlist>
DSH_SSO_OIDC_SESSION_SECONDS=3600
```

Secrets are file-mounted; never build args, image layers, committed `.env` or
logs. The issuer/redirect URI must be HTTPS except for an explicit test mode.
Unknown modes or incomplete OIDC configuration fail closed at startup.

## Protocol design

### Login and callback

1. An unauthenticated request reaches the mandatory gate and is redirected to
   `/auth/login`; no application route is opened.
2. `/auth/login` generates `state` and `nonce`, stores them in a short-lived
   signed, `HttpOnly`, `SameSite=Lax` cookie, and redirects to the issuer's
   authorization endpoint with `response_type=code`, `client_id`,
   `redirect_uri`, `scope=openid`, `state` and an S256 PKCE challenge.
3. `/auth/callback` is an exact allowlisted bypass route. It validates state
   and PKCE before exchanging the code at the token endpoint, with a bounded
   timeout and no redirect following.
4. Validate the ID token: signature against the issuer JWKS, `iss`, `aud`,
   `azp` when multiple audiences, `exp`/`nbf` with small clock skew, `nonce`,
   and the configured subject/group policy. Reject `alg=none`, unknown keys,
   key confusion and duplicate parameters.
5. Map the stable `sub` to the shared owner allowlist and mint the existing
   native DSH cookie through `authorizeIndex`. The OIDC session cookie is
   separate from, and not a substitute for, the edge/gate check.

### Session and logout

- Bind both cookies to the public authority; set `Secure` when the native
  listener is HTTPS or the edge terminates TLS and sets the protocol header in
  a way the deployment explicitly trusts.
- No access/refresh token in browser-visible URLs or logs. Prefer server-side
  session state keyed by an opaque cookie; do not expose an ID token to the
  client.
- Refresh, when needed, happens server-side. A failed refresh denies access
  rather than falling back to a stale identity.
- Logout clears both cookies, revokes local session state and redirects to the
  issuer's end-session endpoint only if configured. Logout is CSRF-protected.
- Existing WebSocket upgrades are bounded by `DSH_SSO_MAX_CONNECTION_SECONDS`;
  logout cannot revoke an already admitted stream instantly.

### Failure behavior

- Discovery/JWKS/token failures fail closed with a fixed error page. Do not
  disclose tokens, raw provider responses or internal URLs.
- Rate-limit login/callback by peer and state-cookie bucket.
- No anonymous source/static/asset exception. `/auth/login` and
  `/auth/callback` are the only exact exceptions, and they serve no application
  data.
- If OIDC mode is misconfigured, startup fails rather than starting a listener
  with a missing gate.

## Security review checklist

- Authorization code interception, replay, state fixation and nonce replay.
- PKCE downgrade, redirect URI allowlist and open redirects.
- JWT signature/JWKS rotation, issuer mix-up, audience confusion, `alg` abuse.
- SSRF through discovery/JWKS URLs; allowlist HTTPS issuer hosts.
- CSRF on login/callback/logout and cookie tossing.
- Session fixation, cookie scope/domain/prefix, `SameSite` behavior.
- Header injection/duplicate parameter handling; reject arrays.
- Resource exhaustion: token/JWKS response size, timeouts, connection limits.
- Log redaction: no code, token, cookie, email or group values.
- Full browser/WebSocket tests with a mock issuer and negative tests.

## Implementation phases

1. **Documentation and test scaffolding.** Freeze this plan, add a mock issuer
   fixture, and keep the current trusted-header tests green.
2. **Generic header refactor.** Add `DSH_SSO_MODE`, configurable header and
   subject pattern; preserve peer CIDR, duplicate-header and allowlist checks.
   No browser auth routes yet. Document edge contract tests.
3. **OIDC core.** Discovery/JWKS cache, state/nonce/PKCE, token exchange, ID
   token validation, allowlist mapping, fixed errors and readiness integration.
4. **Browser integration.** Login/callback/logout routes, native cookie exchange,
   CSRF/session tests, Playwright flow against the mock issuer.
5. **Operational hardening.** Secret-file loading, rotation, rate limits,
   metrics-free logging, timeouts, fuzz/negative tests, packaging docs.
6. **Optional default.** Only after a security review and a full release smoke
   might a deployment choose `DSH_SSO_MODE=oidc`; trusted-header remains the
   compatible default.

## Non-goals

- Multi-user DSH accounts, per-user workspaces, per-user model credentials or
  tenant isolation. All allowed subjects still map to one shared owner.
- Replacing Authentik/Keycloak or implementing MFA inside the plugin.
- Persisting local passwords, private keys or recovery codes.
- Allowing an OIDC login to bypass the raw peer/identity gate or native
  Host/Origin/Connection checks.

## Acceptance for the first implementation

- Trusted-header mode passes all existing SSO tests unchanged.
- OIDC mode passes mock-issuer positive/negative browser tests and survives
  restart with the persisted native cookie.
- A malformed/missing OIDC configuration fails startup closed.
- `/auth/*` is the only unauthenticated route and serves no application data.
- An expired/revoked OIDC session loses application access; an already admitted
  WebSocket is still bounded by the configured maximum lifetime.
- No token, code, cookie, client secret or raw provider response appears in
  logs, errors, readiness output or source archives.
