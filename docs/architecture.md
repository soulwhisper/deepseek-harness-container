# Architecture

## Images and profiles

| Image | Release tag | Profile | Purpose |
| --- | --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | DSH Web, `dshmarket`, required SSO | General DSH Web with owner-approved community plugins |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | Custom Tavern workspace, SSO, ecosystem | Dedicated Tavern instance |

Both use Node 24/glibc, UID/GID `1000:1000`, `tini`, native DSH listening on
port `3080`, and a read-only root filesystem. They are built for native
`linux/amd64` and `linux/arm64`; there is no QEMU path.

The Tavern image additionally retains the complete modified Tavern source at
`/opt/dsh-tavern` and an authenticated corresponding-source archive at
`/opt/dsh-source/tavern.tar.gz`. The source archive contains the Tavern source
plus the distribution build inputs, not installed dependencies or user data.

## Trust path

```text
browser -- HTTPS + IdP session --> verified edge
        -- preserved Host/Origin + exactly one UID header --> DSH native listener
                                                        --> one shared DSH owner
```

The edge performs OAuth/OIDC, login, MFA, session validation and access policy.
The local plugin enforces the raw socket peer CIDR and identity header on every
HTTP request and upgrade. It also protects static assets, source downloads and
the native manager. A clean authenticated index request exchanges a native
`HttpOnly; SameSite=Strict` cookie inside the process; no launch token is
returned in a URL.

The gate is mandatory: if the plugin is missing, unloaded or fails validation,
the Host has no unguarded route. The edge must still restrict network reachability
to the listener; the CIDR allowlist is a second layer, not a replacement.

## Repository drift surfaces

| Path | Owns | Upstream break stays local to |
| --- | --- | --- |
| `patches/dsh/` | Host gate, startup audit, manager policy | DSH host/manager/app-boot files and exact anchors |
| `patches/market/` | Market-to-native-manager bridge | dshmarket artifact and one anchor |
| `patches/tavern/` | Tavern Origin fence and theme limit | Tavern route/theme sources; route and theme hashes |
| `plugins/sso/` | Own SSO plugin, notices, native Connection exchange | This package's API contract and DSH Connection APIs |
| `docker/` | Dockerfile, runtime closure, profile workspaces/locks | Build graph, Node/native ABI, pnpm lock format |
| `scripts/` | Build, state migration, readiness, verification | Maintenance tooling; not a separate runtime |
| `test/` | Behavioral and packaging regressions | Test harness only |
| `docs/` | Durable contracts, plans and source/license text | Documentation and compliance wording |
| `deploy/` | Compose/Kubernetes application examples | Example topology; the real edge/IdP remains external |
| `.github/` | CI, release, labels and review policy | Automation permissions and release route |

The Docker build context is the repository root, but the final images receive
only the explicit build/source inputs defined in the `distribution-source`
stage. Test, smoke, deploy, CI and general documentation trees are not copied
into either image.

## Static and persistent layout

| Area | Examples | Nature |
| --- | --- | --- |
| Immutable image | `/opt/dsh/runtime`, `/opt/dsh-seed`, `/opt/dsh/profiles`, `/opt/dsh-tavern`, `/opt/dsh-source` | Read-only, replaced by image |
| Durable DSH state | `/data/dsh` profiles, sessions, storages, attachments, credentials | Back up encrypted |
| Durable home | `/data/home` HOME, XDG config/data, pnpm home | Back up |
| Durable projects | `/workspace` | Back up consistently with DSH state |
| Rebuildable cache | `/cache` and `$DSH_HOME/cache` symlink | May be lost |
| Diagnostics | `/logs` and `$DSH_HOME/logs` symlink | Sensitive, not authoritative |
| Local rollback | `/backups` | Not an independent backup |
| Scratch | `/tmp` | tmpfs, may be `noexec` |

The entrypoint materializes state first, then points DSH's hard-coded
`$DSH_HOME/cache` and `$DSH_HOME/logs` paths at the dedicated volumes. Migration
backups exclude those two subtrees. Exact backup policy is in
[data layout](data-layout.md).

## Release identity

Only `web-<dsh-version>` and `tavern-<version>` tags publish. The tag must match
`versions.json`, point into `main`, and is built and smoked on native amd64 and
arm64 runners. The combine job creates one multi-arch index; there is no
floating `latest` and no branch candidate image. Deployments should pin the
resulting digest.
