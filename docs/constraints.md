# Constraints

These are the invariants behind the image and deployment examples. A change
that relaxes one needs an explicit design review, tests and updated pins.

## Upstream and compatibility

- DSH `0.2.1-rc.2` is a developer preview, not an audited production platform.
- `versions.json`, committed runtime/profile locks and the Dockerfile are the
  compatibility boundary. Do not assume every upstream RC or plugin combination
  works.
- Version-only dependency bumps are incomplete. A DSH or Tavern change also
  updates source commits, exact patch hashes, locks, release tags and docs.
- The Web image follows DSH; the Tavern image follows dsh-tavern. They release
  independently and must never share a live DSH home.

## Security boundary

- The native DSH listener is never exposed directly. A verified edge terminates
  public TLS and authenticates every HTTP request and WebSocket upgrade.
- The current `@soulwhisper/dsh-sso` is a **trusted-header gate**, not an OIDC
  client. It checks the real TCP peer CIDR and exactly one authenticated UID
  header, then exchanges DSH's native cookie through its own Connection APIs.
- The edge must remove client-supplied identity headers, set exactly one stable
  Authentik UID, preserve public Host/Origin and be the only allowed peer.
- All admitted UIDs are one shared DSH owner. They share sessions, files,
  credentials, tools and model access. This is not multi-user isolation.
- Missing, unloaded or failed SSO denies application routes; it must never fall
  back to an unguarded listener. The Host patch's exact-hash gate is mandatory.
- A working login does not prove the agent sandbox, model providers, plugins or
  backups are safe. Test those independently.

## Runtime and packaging

- Startup installs nothing. Build tools and pnpm remain in the image only for
  explicitly approved plugin operations by the owner.
- Runtime and seed paths under `/opt` are immutable. Only `/data/dsh`,
  `/data/home`, `/workspace` and the declared cache/log/rollback roots are
  writable.
- `/data/dsh` and `/workspace` are durable state; `/cache`, `/logs`, `/backups`
  and `/tmp` are not authoritative state. See [data layout](data-layout.md).
- One DSH process writes a home. Never attach two live writers to one home,
  even on a shared RWX volume.
- `/tmp` may be `noexec`. Native addons load from the immutable image with
  `NARB_DISABLE_NATIVE_CACHE=1`; do not rely on executable temporary files.
- The final images contain no Chromium, GUI, X11, VNC, TCP relay, local
  password database or replacement mux server. Browsers are CI test
  dependencies only.

## Deployment

- Bind `DSH_HOST` to one concrete container/Pod IP. Service VIPs, wildcard
  addresses and `0.0.0.0`/`::` are rejected.
- Use one StatefulSet replica with RWO `/data` and `/workspace` claims. Active-
  active replicas and hot failover are not supported by DSH; see [HA plan](ha-plan.md).
- Pin an inspected image digest. Do not use `latest`, branch publication or a
  mutable tag as the production identity.
- No secret belongs in a build argument, image layer, committed `.env` or issue.
- Backups contain credentials, attachments and conversations; encrypt them and
  restrict access. A `/backups` rollback copy is not an independent backup.

## Licenses

Original distribution code is Apache-2.0. Upstream MIT notices are preserved.
Tavern is AGPL-3.0-only and its complete modified source plus build recipe must
remain available through the authenticated source route. See
[regulations](regulations.md).
