# DeepSeek Harness Container

English | [简体中文](README.zh-CN.md)

An independent, self-packaged [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) distribution for a **single shared owner behind a verified forward-auth edge**. It ships two OCI images, an independently maintained forward-auth gate, explicit state and backup boundaries, and no desktop stack.

> DSH `0.2.1-rc.2` is a developer preview, not an audited production platform. A working login does not prove the edge, plugins, model credentials, backups or agent sandbox are safe. Never expose the native listener directly.

## Images

| Image | Release tag | Profile |
| --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | DSH Web + `dshmarket` + `dsh-context` + required forward-auth |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | Custom Tavern workspace + forward-auth + bundled ecosystem |

Web follows the DSH upstream version; Tavern follows dsh-tavern. They are
released independently, use Node 24/glibc, run as UID/GID `1000:1000`, bind
exactly one concrete IP on port `3080`, and use a read-only root filesystem.
Both are built natively for `linux/amd64` and `linux/arm64` (no QEMU). The
images contain no Chromium, GUI, X11, VNC, local password database, OIDC client
or replacement mux server.

The Web image seeds the optional Caveman and RTK skills, installs the RTK OSS
binary and bundles `dsh-context`. Tavern intentionally includes none of these
optional assets. The three upstream inputs are resolved at Web image-build time
from their latest upstream state; they are not version-pinned or tracked by
Renovate, so deploy the published digest rather than expecting a reproducible
rebuild from `latest`. See [build](docs/build.md#floating-optional-assets).

## Documentation

| Document | Contents |
| --- | --- |
| [Documentation home](docs/index.md) | Reading paths, images and safety summary |
| [Architecture](docs/architecture.md) | Images, trust boundary, repository layout |
| [Constraints](docs/constraints.md) | Security and compatibility rules |
| [Build](docs/build.md) | Docker targets, source payload, locks |
| [Deploy](docs/deploy.md) | Compose and Kubernetes examples |
| [Operations](docs/operations.md) | Boot, migration, backup, rollback |
| [Data layout](docs/data-layout.md) | Durable state vs cache/logs/rollback/tmp |
| [Patches](docs/patches.md) | Exact-hash upstream modifications |
| [Source build](docs/source-build.md) | Tavern corresponding source |
| [Licensing](docs/regulations.md) | Apache/MIT/AGPL obligations |
| [Forward-auth](docs/forward-auth.md) | Trusted-edge authentication, status logs, token URL |

Documentation is English-only under `docs/`; the root Chinese README is a
localized entry point, not a second docs tree.

## Build

Build context is the repository root; the Dockerfile is `docker/Dockerfile`.

```bash
# Use linux/arm64 instead on an arm64 host.
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

The final image payload is explicitly whitelisted: test, smoke, deploy, CI and
general documentation trees do not ship. Read [build](docs/build.md) before
changing a lock, patch, source commit or release tag.

## Run

Production must use an inspected `@sha256:…` digest, not a mutable tag. The
following is an application-side example with a pre-existing verified edge on a
private network; it publishes no host port.

```bash
docker network create --subnet 172.30.80.0/24 dsh-private
docker volume create dsh-web-data
docker volume create dsh-web-workspace
docker volume create dsh-web-cache
docker volume create dsh-web-logs
docker volume create dsh-web-backups

export IMAGE=ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2
export ALLOWED_SUBJECTS='your-stable-owner-id'

docker run --detach --name dsh-web --restart unless-stopped \
  --network dsh-private --ip 172.30.80.3 \
  --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --mount type=volume,src=dsh-web-data,dst=/data \
  --mount type=volume,src=dsh-web-workspace,dst=/workspace \
  --mount type=volume,src=dsh-web-cache,dst=/cache \
  --mount type=volume,src=dsh-web-logs,dst=/logs \
  --mount type=volume,src=dsh-web-backups,dst=/backups \
  --env DSH_HOST=172.30.80.3 \
  --env DSH_PUBLIC_URL=https://dsh.example.net \
  --env DSH_TRUSTED_HOSTS=dsh.example.net \
  --env DSH_FORWARD_AUTH_HEADER=x-authentik-uid \
  --env DSH_FORWARD_AUTH_ALLOWED_SUBJECTS="$ALLOWED_SUBJECTS" \
  --env DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS=172.30.80.2/32 \
  "$IMAGE"
```

Open the clean HTTPS edge URL, never a startup-log URL. Use a separate
container, `/data`, `/workspace`, cache/log/backup roots and listener IP for
Tavern. Compose and Kubernetes examples are in
[`deploy/`](deploy/), with operating details in [deploy](docs/deploy.md).

## State and backup boundary

| Path | Treatment |
| --- | --- |
| `/data/dsh` | Durable profiles, sessions, storages, attachments and credentials. Back up encrypted. |
| `/data/home` | Durable HOME/XDG/tool state. Back up. |
| `/workspace` | Durable user projects. Snapshot consistently with `/data/dsh`. |
| `/cache` | Rebuildable cache; `$DSH_HOME/cache` is a symlink here. May be lost. |
| `/logs` | DSH startup diagnostics; `$DSH_HOME/logs` is a symlink here. Sensitive, non-authoritative. |
| `/backups` | Local migration rollback copy under `DSH_BACKUP_ROOT`; not an independent backup. |
| `/tmp` | Per-container tmpfs scratch; may be `noexec`. |
| `/opt/dsh`, `/opt/dsh-seed`, `/opt/dsh-tavern`, `/opt/dsh-source` | Immutable image content. |

Do not place cache, logs, rollback copies or scratch inside `/data`; the
entrypoint moves legacy `cache`/`logs` directories once and excludes them from
rollback copies. See [data layout](docs/data-layout.md).

## Forward-auth boundary

The verified edge, not this image, performs OAuth/OIDC, login, MFA, session
validation and access policy. It must authenticate every HTTP request and
WebSocket upgrade, remove client-supplied identity headers, set exactly one
configured stable subject header, preserve public Host/Origin and be the only
network peer allowed to reach DSH.

`@soulwhisper/dsh-forward-auth` checks the real peer CIDR and subject allowlist,
protects assets/source/native manager, and exchanges a native
`HttpOnly; SameSite=Strict` cookie through DSH Connection APIs. The header is
configurable (`x-authentik-uid`, Authelia `Remote-User`, etc.); no OIDC client,
local password, bootstrap admin or user panel is included. Missing or failed
authentication denies routes; there is no unguarded fallback. All allowed
subjects share one DSH owner and its files, tools, models and credentials; this
is not multi-user isolation.

The gate also rejects any request whose query contains a `token` parameter,
including the upstream DSH launch-token URL. Startup stdout may still contain
that token; treat logs as sensitive. Status logs report `waiting-for-edge`,
`active`, rate-limited denial reasons, or `broken` with a fixed category. See
[forward-auth](docs/forward-auth.md).

## Release and automation

Only `web-<dsh-version>` and `tavern-<version>` tags publish. Each tag must match
`versions.json`, point into `main`, is built and smoked on native amd64/arm64
runners, and is combined into one multi-arch index. There is no `latest` image
tag, no branch publication and no candidate `sha-` image; the optional
`dsh-context`, Caveman and RTK inputs are floating build-time upstream assets,
not release tags. PRs always run the required static checks and tests; native
image smoke runs when image/build inputs change. Pull requests receive no
repository secrets. The same-repo PR
labeler and scheduled label sync use job-scoped default tokens with only
`pull-requests: write` or `issues: write`. Registry pushes use the job-scoped
`GITHUB_TOKEN` with `packages: write`; release notes and cleanup use the GitHub
App. Build/test jobs never receive App credentials.

Renovate is advisory and never auto-merges. Coupled pins (source commits, exact
patch hashes, theme hashes, locks and release tags) must be updated by a human.

## HA limitation

The deployment is a single StatefulSet replica with RWO `/data` and
`/workspace`. DSH has process-local sessions, per-session `flock` but no
home-wide leader election, and no live-session handoff. Do not scale to two
replicas or attach a shared RWX home as a failover. A PDB protects voluntary
disruption only. This is a DSH limitation, not a Kubernetes tuning problem.

## License and corresponding source

Original distribution code is Apache-2.0 under [LICENSE](LICENSE). Upstream
MIT notices are preserved in [NOTICE](NOTICE). Tavern is
**AGPL-3.0-only**; its modified source and build recipe remain in the Tavern
image, and authenticated users can download the corresponding-source archive
at `/distribution/source.tar.gz`. Keep that offer available and comply with
the AGPL when modifying or redistributing Tavern. See
[regulations](docs/regulations.md) and [source build](docs/source-build.md).
