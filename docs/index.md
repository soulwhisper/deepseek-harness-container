# DeepSeek Harness Container

An independent, self-packaged [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
distribution for **one shared owner behind a verified forward-auth edge**. It
ships two OCI images, an independently maintained authentication gate, explicit
state and backup boundaries, and no desktop stack.

!!! warning "Developer preview"
    DSH `0.2.1-rc.2` is a developer preview, not an audited production platform.
    A working login does not prove the edge, plugins, model credentials, backups
    or agent sandbox are safe. Never expose the native DSH listener directly.

## Images

| Image | Release tag | Profile |
| --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | DSH Web + `dshmarket` + required forward-auth |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | Custom Tavern workspace + forward-auth + bundled ecosystem |

Web follows the DSH upstream version. Tavern follows dsh-tavern. They release
independently, use Node 24/glibc, run as UID/GID `1000:1000`, bind one concrete
IP on port `3080`, and use a read-only root filesystem. Both are built natively
for `linux/amd64` and `linux/arm64`; there is no QEMU fallback.

## Choose a path

| If you want to… | Read |
| --- | --- |
| Understand the images and trust boundary | [Architecture](architecture.md) |
| Check the rules that must not silently change | [Operating constraints](constraints.md) |
| Configure the edge and identity header | [Authentication](forward-auth.md) |
| Build or change an image | [Build and release](build.md) |
| Understand the exact upstream modifications | [Upstream patches](patches.md) |
| Deploy Compose or Kubernetes | [Deployment](deploy.md) |
| Run upgrades, rollback and backups | [Operations](operations.md) |
| Decide what to back up | [State and backup](data-layout.md) |
| Evaluate replicas, PDB or shared RWX | [HA limits](ha-plan.md) |
| Redistribute or satisfy source obligations | [Licensing](regulations.md) and [Corresponding source](source-build.md) |

## Safety rules

- Authenticate every HTTP request and WebSocket upgrade at a verified edge.
- Remove client-supplied identity headers and inject exactly one configured
  subject header.
- Restrict network reachability to the DSH listener; the peer CIDR check is a
  second layer, not a replacement for network policy.
- Never expose the native listener directly and never rely on the upstream
  launch-token URL as authentication.
- Keep one live DSH writer per home. Do not scale a StatefulSet to two replicas
  or use shared RWX storage as hot failover.
- Back up `/data/dsh`, `/data/home` and `/workspace` together. Backups contain
  credentials, attachments and conversations; encrypt them.

All admitted subjects share one DSH owner and its sessions, files, tools and
model credentials. This is not a multi-user authorization boundary.

## Repository map

| Path | Purpose |
| --- | --- |
| `patches/` | Exact-hash DSH, market and Tavern source modifications |
| `plugins/forward-auth/` | Own trusted-edge authentication plugin |
| `docker/` | Dockerfile, runtime closure and profile recipes/locks |
| `scripts/`, `test/` | State migration, readiness, verification and regressions |
| `docs/` | Durable operating, build and licensing contracts |
| `deploy/` | Compose and Kubernetes application-side examples |
| `.github/` | PR validation, release, labels and review automation |

The Docker build context is the repository root, but final images receive only
an explicit whitelisted payload. Tests, deploy examples, CI and general docs do
not ship. See [Build and release](build.md).

## Documentation conventions

- Describe checked behavior, not aspirational behavior. Name the image digest or
  commit when a claim depends on a build.
- Security-boundary changes need a matching test and exact pin update.
- Upstream drift belongs in `patches/`, `versions.json` or `docker/`; do not hide
  it in prose.
- Keep this directory English-only. Localized entry READMEs stay at the
  repository root and do not create a second documentation tree.
- Do not commit transient handoff notes. Durable decisions belong in one of the
  pages listed above.
