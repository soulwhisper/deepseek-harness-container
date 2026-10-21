# Operating constraints

These are the invariants behind the images and deployment examples. Relaxing one
requires an explicit design review, tests and updated pins.

## Compatibility

- DSH `0.2.1-rc.2` is a developer preview, not an audited production platform.
- `versions.json`, committed runtime/profile locks and `docker/Dockerfile` are the
  compatibility boundary. Do not assume every upstream RC or plugin combination
  works.
- A version-only dependency bump is incomplete. A DSH or Tavern change also
  updates source commits, exact patch hashes, locks, release tags and docs.
- The Web image follows DSH. The Tavern image follows dsh-tavern. They release
  independently and must never share a live DSH home.

See [Upstream patches](patches.md) for the update sequence.

## Security boundary

- The native DSH listener is never exposed directly. A verified edge terminates
  public TLS and authenticates every HTTP request and WebSocket upgrade.
- `@soulwhisper/dsh-forward-auth` is a **trusted-edge header gate**, not an OIDC
  client. It checks the real TCP peer CIDR and exactly one configured subject
  header, then exchanges DSH's native cookie through its own Connection APIs.
- The edge must remove client-supplied identity headers, set exactly one stable
  subject header, preserve public Host/Origin and be the only allowed peer.
- All admitted subjects are one shared DSH owner. They share sessions, files,
  credentials, tools and model access. This is not multi-user isolation.
- Missing, unloaded or failed forward-auth denies application routes. It must
  never fall back to an unguarded listener. There is no local password or
  bootstrap admin.
- The upstream DSH launch-token URL is blocked by the gate. It is not an
  authentication path.

A working login does not prove the agent sandbox, model providers, plugins or
backups are safe. Test those independently.

## Runtime and packaging

- Startup installs nothing. Build tools and pnpm remain in the image only for
  explicitly approved plugin operations by the owner.
- Runtime and seed paths under `/opt` are immutable. Only `/data/dsh`,
  `/data/home`, `/workspace` and the declared cache/log/rollback roots are
  writable.
- `/data/dsh` and `/workspace` are durable state. `/cache`, `/logs`, `/backups`
  and `/tmp` are not authoritative state. See [State and backup](data-layout.md).
- One DSH process writes a home. Never attach two live writers to one home, even
  on a shared RWX volume.
- `/tmp` may be `noexec`. Native addons load from the immutable image with
  `NARB_DISABLE_NATIVE_CACHE=1`; do not rely on executable temporary files.
- The final images contain no Chromium, GUI, X11, VNC, TCP relay, local password
  database or replacement mux server.

## Deployment

- Bind `DSH_HOST` to one concrete container/Pod IP. Service VIPs, wildcard
  addresses and `0.0.0.0`/`::` are rejected.
- Use one StatefulSet replica with RWO `/data` and `/workspace` claims.
  Active-active replicas and hot failover are not supported by DSH.
- Pin an inspected image digest. Do not use `latest`, branch publication or a
  mutable tag as the production identity.
- No secret belongs in a build argument, image layer, committed `.env` or issue.
- Backups contain credentials, attachments and conversations. Encrypt them and
  restrict access. A `/backups` rollback copy is not an independent backup.

## Licensing

Original distribution code is Apache-2.0. Upstream MIT notices are preserved.
Tavern is AGPL-3.0-only, and its complete modified source plus build recipe must
remain available through the authenticated source route. See
[Licensing](regulations.md).
