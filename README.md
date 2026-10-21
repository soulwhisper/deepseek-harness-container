# DeepSeek Harness Container

English | [简体中文](README.zh-CN.md)

An independent, self-packaged [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) distribution for a **single shared owner behind an Authentik-verified edge**. Two OCI images, an independently maintained SSO plugin, persistent state, and no desktop stack.

> DSH `0.2.1-rc.2` is a developer preview, not an audited production platform. A working login is not proof that your proxy, plugins, model credentials or agent sandbox are safe. Do not expose the application listener directly.

## Images and scope

| Image | Release tag | Included profile | Intended use |
| --- | --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | Official Web + `dshmarket` + `@soulwhisper/dsh-sso` | General DSH Web and user-added community plugins |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | Custom Tavern workspace build + SSO + bundled ecosystem | Dedicated Tavern instance |

Each image follows its own upstream version: Web tracks DSH, Tavern tracks dsh-tavern. Tavern's upstream `v3.0` tag is published as `3.0` to match the Web tag style (no `v` prefix). They are released independently; a Tavern upstream change does not require or delay a Web release, and vice versa.

Both use Node 24/glibc, UID/GID `1000:1000`, `tini`, native DSH binding on port `3080`, and a read-only root filesystem. There is **no Chromium, GUI, X11, VNC, browser desktop, TCP relay, OIDC client, local user/password database or replacement mux server**. Build tools and pnpm remain available for explicitly approved community-plugin operations; startup itself installs nothing.

CI builds **`linux/amd64` and `linux/arm64`** on native GitHub runners (`ubuntu-24.04` and `ubuntu-24.04-arm`) and runs the full Chromium/browser smoke on both. There is no QEMU or cross-architecture emulation. Apple Silicon can therefore run the arm64 image natively; this is a Linux container image, not a macOS host application. Read workflow results for the exact commit you intend to run; this README does not certify an unrun build. Repository organization takes inspiration from [runzhliu/deepseek-harness-docker](https://github.com/runzhliu/deepseek-harness-docker), but this is a different distribution and trust model, not its desktop image.

## Repository layout

| Path | Contents | Drift boundary |
| --- | --- | --- |
| [`patches/`](patches/) | `dsh/` exact-hash Host/manager/app-boot patch, `market/` managed-runtime bridge, `tavern/` route and theme patch | Rebasing against changed upstream; every patch rejects unknown hashes or anchors |
| [`plugins/sso/`](plugins/sso/) | `@soulwhisper/dsh-sso`, its Cordis row and license notices | Independently maintained own code |
| [`docker/`](docker/) | `Dockerfile`, `runtime/` dependency closure, `profiles/` recipes and committed locks | Image build only; upstream pins live in `versions.json` |
| [`scripts/`](scripts/), [`test/`](test/), [`docs/`](docs/) | Scaffold/maintenance scripts, regression tests, smoke harness and handoff notes | Never shipped as a separate runtime |
| [`deploy/`](deploy/) | Docker Compose and Kubernetes examples | Examples only; the verified edge and IdP stay external |

Build with `-f docker/Dockerfile`; the BuildKit context remains the repository root. Keeping patches, the SSO plugin, image build and examples in separate trees makes an upstream break local to one area instead of forcing a whole-repository rebase.

## Automation and review

- **PR only.** `main` is protected: no direct pushes, no force pushes, linear history, required `CI checks passed`, and an up-to-date branch. CODEOWNERS routes the security-critical paths. `ci.yaml` runs on pull requests and merge groups, builds each target on native amd64 and arm64 runners and runs the full browser smoke on both. The separate `labeler.yaml` handles labels. Public/fork PR submissions are intentionally unsupported; their jobs are skipped.
- **Release path.** Only `web-<dsh-version>` and `tavern-<version>` tags publish. Each tag must match `versions.json`, point into `main`, builds its target on native amd64+arm64 runners, smokes both, then combines the tested manifests into the version index. Branch pushes never publish and there are no candidate `sha-` images.
- **Scheduled hygiene.** `schedule-cleanup.yaml` prunes cancelled/skipped and old successful/failed runs; `label-sync.yaml` restores the reviewed label set. Both use GitHub App tokens.
- **Direct field test.** `field-test.yaml` runs on release tags and manual dispatch without Docker: it installs the production runtime closure on a native amd64/arm64 runner, applies the exact-hash host and market patches, and verifies the patched host/manager/app-boot/market plus a native PTY. This complements, and does not replace, the final-image smoke.
- **Renovate is advisory only.** The runner and base configuration live in [`soulwhisper/renovate-config`](https://github.com/soulwhisper/renovate-config); this repository contains only overrides under [`.renovate/`](.renovate/) referenced by [`renovate.json`](renovate.json). It tracks the DSH npm upstream, the Tavern GitHub tag, `dshmarket`, root/dev dependencies and SHA-pinned Actions. It never auto-merges; every PR gets `review/required`. Because DSH is a developer preview, even patch and digest updates must be inspected and fixed by a human.
- **Coupled pins are manual.** Node digest, pnpm, source commits, exact patch hashes, Tavern ecosystem plugins and profile locks do not move on their own. A Renovate version-only PR is expected to fail verification until the commit/hash/lock/release-tag updates are added deliberately.
- **CodeRabbit is advisory.** Install the CodeRabbit GitHub App on this repository. It reviews non-Renovate PRs with actionlint, zizmor, shellcheck, yamllint and gitleaks; it never approves or merges. The GitHub App credentials `APP_CLIENT_ID`/`APP_PRIVATE_KEY` need Actions write for cleanup, Contents write for releases, Packages write for GHCR, Issues write for label sync and Pull requests write for the separate labeler. Every write token is minted by the GitHub App; the default bot token is used only for read-only checkout.
- **Renovate activation.** The shared Renovate runner selects repositories by topic, so this repository carries `managed-by-renovate`. If the topic or App installation is removed, updates stop silently even though `renovate.json` remains.
- **One automation identity.** Every repository write is minted by the same GitHub App installation: labeler, label sync, cleanup, GHCR publication and release metadata. Workflows never use `github.token` for writes, never push commits as `github-actions[bot]`, and the shared Renovate runner uses the same App. The default token is read-only checkout only.

| Workflow | Trigger | Repository write |
| --- | --- | --- |
| `ci.yaml` | PR `opened/synchronize/reopened/ready_for_review`, merge group, manual | None |
| `field-test.yaml` | Tag creation, matching PR paths, manual | None |
| `labeler.yaml` | PR on `main`, same repository only | App: pull requests |
| `publish.yaml` | `web-*`/`tavern-*` tag creation | App: contents + packages |
| `label-sync.yaml` | Schedule, `main` labels change, manual | App: issues |
| `schedule-cleanup.yaml` | Schedule, manual; serialized | App: actions |
| `profile-locks.yaml` | Manual only | Artifact upload only |

Feature-branch pushes do not trigger CI or publication. A merge does not re-run PR validation; release runs only when a matching tag is created.

## Pinned baseline

[`versions.json`](versions.json), committed dependency locks and [`docker/Dockerfile`](docker/Dockerfile) are authoritative.

| Component | Pin |
| --- | --- |
| Web image / release tag | `dsh-web:0.2.1-rc.2` / `web-0.2.1-rc.2` |
| Tavern image / release tag | `dsh-tavern:3.0` / `tavern-3.0` |
| Distribution | `0.2.1-rc.2-r1` |
| Official DSH | `0.2.1-rc.2`, commit `687f282e8625c6b8d11ff58211a90524be2e4317` |
| Node / pnpm | `24.22.0` / `11.25.0` |
| DSH Market | `1.66.44` |
| Tavern | `v3.0`, commit `7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d` |
| Wrongbook / illustration / Knock Knock | `v1.33.0` / `v2.9.0` / `v0.7.1` |
| Narrative Anchor | `2ee3da047e5fd6056aef361744655be99b4f7713` |

The Tavern source workspace is installed before generating a pruned profile; stable absolute links point into `/opt/dsh-tavern/apps/dsh-tavern`. Plain `dsh plugin add` of Tavern core is **not** an equivalent build. The package called `dsh-tavern-comfy` comes from `dsh-tavern-image`.

## Prerequisites and the SSO boundary

You need an amd64 Linux Docker host with Buildx, storage writable by UID/GID 1000, and a correctly configured Authentik forward-auth/verified-edge deployment. The edge—not this plugin—performs OAuth/OIDC, login, MFA, session validation and access policy.

```text
Browser -- HTTPS + IdP session --> verified edge
        -- preserved Host/Origin + exactly one x-authentik-uid --> native DSH listener
                                                        --> one shared DSH owner
```

The edge must:

1. Authenticate **every HTTP request and WebSocket upgrade**, including static files.
2. Remove all client-supplied `x-authentik-*` headers, then set exactly one `x-authentik-uid` from the **verified stable Authentik UID**, not username/email/display name.
3. Preserve the public `Host` and browser `Origin`; forward WebSocket upgrades without parsing mux frames.
4. Be the only network peer allowed to reach DSH. Restrict the listener with private networking/firewall or your platform's equivalent, in addition to the plugin's explicit peer CIDRs. Do not trust arbitrary forwarded IP headers or a whole shared cluster range.

The mandatory raw pre-dispatch guard checks the real socket peer and allowed UID on every HTTP/upgrade. Duplicate/missing/unknown UIDs and untrusted peers are denied. It also guards assets and the source archive. Missing, unloaded or failed SSO leaves app routes unavailable; it does not restore an unguarded listener. The official host patch is exact-hash checked and must be deliberately ported when upstream changes.

A trusted clean index request exchanges native authorization **inside the process**, using DSH's own Connection APIs. The browser receives a native `HttpOnly; SameSite=Strict` cookie; no static token or launch-token URL is published. **That cookie never bypasses the edge/UID checks.** Native Host/Origin checks remain in force.

`DSH_SSO_MAX_CONNECTION_SECONDS` bounds an already admitted upgrade (default 900 seconds), requiring reconnection through the edge. This is not instant IdP logout propagation inside an existing stream. All allowed UIDs share sessions, files, tools, models and credentials as the **same DSH owner**. This is not multiuser or tenant isolation; separate mutually untrusted people into separate instances and volumes. It does not preserve `dsh-ui-auth` accounts, invitations, per-user ownership, private-key envelopes or sharing UI.

## Quick deployment

First publish or locally build the chosen image. Tags follow each image's upstream version; they do not imply that its first release has already been published.

```bash
# From a clean checkout with all committed locks available:
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

For deployment, prefer the immutable `@sha256:…` digest from a successful trusted CI run. There is deliberately no `latest` tag. Do not bake credentials, UIDs or proxy private keys into build arguments.

### Docker with an existing verified edge

The following is an application-side example, **not a complete Authentik installation**. Pick a non-conflicting private subnet. Configure your real edge to join it at `172.30.80.2`, perform the checks above, and forward to `172.30.80.3:3080`. Replace the example domain and stable UID. No app port is published to the host.

```bash
docker network create --subnet 172.30.80.0/24 dsh-private
docker volume create dsh-web-data
docker volume create dsh-web-workspace

# Set IMAGE to an inspected immutable digest, or use dsh-web:local for a local build.
export IMAGE=ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2
export ALLOWED_UIDS='your-stable-authentik-uid'

docker run --detach --name dsh-web --restart unless-stopped \
  --network dsh-private --ip 172.30.80.3 \
  --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --mount type=volume,src=dsh-web-data,dst=/data \
  --mount type=volume,src=dsh-web-workspace,dst=/workspace \
  --env DSH_HOST=172.30.80.3 --env DSH_PUBLIC_URL=https://dsh.example.net \
  --env DSH_TRUSTED_HOSTS=dsh.example.net \
  --env DSH_SSO_ALLOWED_UIDS="$ALLOWED_UIDS" \
  --env DSH_SSO_TRUSTED_PROXY_CIDRS=172.30.80.2/32 \
  "$IMAGE"
```

Compose and Kubernetes equivalents are in [`deploy/docker`](deploy/docker) and [`deploy/kubernetes`](deploy/kubernetes). They are application-side examples, not a verified edge; pin an inspected digest in production instead of the version tag.

Open the **clean HTTPS edge URL**, not a startup log URL. Use a separate container, `/data` volume and `/workspace` volume for Tavern; change the image/name and allocate a distinct listener IP. Never point both images at the same live DSH home. In an orchestrator, set `DSH_HOST` to the concrete Pod/container IP and use a single stateful replica; service VIPs and wildcard addresses are not native bind addresses.

### Configuration

| Variable | Meaning |
| --- | --- |
| `DSH_HOST` | Concrete local listener IP; required, not `0.0.0.0`/`::` |
| `DSH_PORT` | Native listener port, default `3080` |
| `DSH_PUBLIC_URL` | Advertised clean public URL; does not configure access control or TLS |
| `DSH_TRUSTED_HOSTS` | Comma/space-separated public authorities; emitted as repeated native trusted-host options |
| `DSH_SSO_ALLOWED_UIDS` | **Required**, comma-separated stable UID allowlist |
| `DSH_SSO_TRUSTED_PROXY_CIDRS` | **Required**, explicit real-peer CIDR allowlist; use narrow `/32` or `/128` where possible |
| `DSH_SSO_MAX_CONNECTION_SECONDS` | Admitted-upgrade lifetime; default `900` |
| `DSH_TLS_CERT`, `DSH_TLS_KEY` | Paired read-only native-listener TLS certificate/key paths |
| `DSH_STATE_MIGRATION` | `refuse` by default; `apply` explicitly adopts existing/different-version state after backup |
| `DSH_LEGACY_HOME` | Legacy home source, default `/home/node/.dsh`; migration copies, never deletes the source |

The image selects its profile; `DSH_PROFILE=web` or `tavern` must agree with it. `DSH_HOME=/data/dsh`, `HOME=/data/home`, `XDG_CACHE_HOME=/data/cache` and working directory `/workspace` are the persistent layout. Do not redirect immutable source/runtime paths into user state.

### TLS and readiness

Native TLS is recommended when the edge-to-DSH link needs encryption or native `Secure` cookies. Mount the certificate/key read-only, readable by UID 1000, set **both** TLS variables, and configure the edge to verify the backend certificate and hostname. Preserve public Host/Origin even when the backend is addressed by IP. Certificate changes require restart. A missing/bad certificate must fail rather than fall back to plaintext.

`DSH_PUBLIC_URL=https://…` alone does **not** enable native TLS or a `Secure` cookie. Moving the native listener from HTTP to HTTPS changes native cookie identity; expect reauthentication. Do not paper over this with a blanket cookie rewrite or stripped Origin.

Readiness is local only:

```bash
docker exec dsh-web node /opt/dsh/scripts/readiness.mjs
```

It connects to `/tmp/dsh-sso-ready.sock`, which replies `ready\n` only after the native startup audit has succeeded and while the mandatory gate remains active. There is no unauthenticated public health endpoint. Readiness proves the audited guarded process is serving, not that the IdP, model providers or agent sandbox work.

## Persistence, migration and rollback

| Path | Treatment |
| --- | --- |
| `/data/dsh` | Durable profiles, settings, credentials, sessions and storage; back up as secrets |
| `/data/home` | Durable shell/tool home and plugin-manager state |
| `/data/cache` | Writable cache; may be rebuilt, but don't share it across unrelated owners |
| `/workspace` | Durable user projects; snapshot consistently with DSH state |
| `/tmp` | Per-container scratch/tmpfs; never a backup location |
| `/opt/dsh/runtime`, `/opt/dsh-seed`, `/opt/dsh-tavern` | Immutable image content, not portable data volumes |

Fresh empty state is seeded once. Existing state from another version/profile or an unrecognized layout is refused unless you explicitly set `DSH_STATE_MIGRATION=apply`. Migration updates managed dependencies/links and removes obsolete `dsh-ui-auth` activation while preserving unrelated state. It creates a local rollback copy under `/data/dsh-migrations`; this is **not** an independent backup or an atomic filesystem snapshot.

Before migrating, stop the old instance, snapshot/export **both `/data` and `/workspace`**, record its image digest and proxy/TLS configuration, and test restore into a separate location. For the old `/home/node/.dsh` layout, mount the old backup read-only at that path or set `DSH_LEGACY_HOME`; mount the new writable `/data` separately and apply migration once. Keep the original untouched. Existing user dependencies need a compatible committed profile lock; incompatible pnpm formats require offline migration, not lockfile deletion.

Credentials must remain owner-only (not group-readable); do not recursively chmod a credential volume to `0777` or copy foreign native `node_modules` across architectures/libc/layouts. Old `dsh-ui-auth` private model keys are encrypted with the old local password: export/re-enter them deliberately before retiring the old instance. SSO login cannot decrypt them.

For rollback, stop the new instance, restore the **pre-upgrade** state/workspace snapshots into separate volumes, restore the previous proxy/TLS settings, and run the previous pinned digest. Do not simply attach an old image to already migrated data. Never run two writers against one home. Backups contain credentials and personal conversations: encrypt them and restrict access; do not upload raw boot logs or backup archives to issues.

## Plugin updates versus distribution updates

- **Distribution-owned** DSH, SSO, guard patches and bundled baseline packages change through reviewed source/lock updates and a rebuilt image. The native manager must not disable/remove the required SSO boundary or replace protected image dependencies.
- **User-added Web plugins** use the native plugin-manager path and its actual script approvals, with pnpm operating on the writable profile. The market is not an alternate privileged installer. Treat plugin installation as code execution with the owner's files/credentials, not as a sandboxed marketplace purchase.
- **Tavern core** needs its custom pinned workspace recipe. Update source commit, patches, profile lock and image together. Runtime `plugin add` of core is not a supported shortcut. Back up cards/campaign data before changing ecosystem plugins.

Changing only an image tag does not automatically approve a state migration, update a community plugin or prove compatibility. Do not install/update packages during startup or downgrade pnpm to 10 to make a lock appear readable.

## Build, smoke and release

Prerequisites for local smoke: Node 24, pnpm 11.25.0, Docker/Buildx and a host-side Playwright Chromium installation. The browser is a **test dependency outside the images**.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install --with-deps chromium
node scripts/verify.mjs
node --test test/*.test.mjs
node scripts/smoke.mjs dsh-web:local dsh-tavern:local
```

Smoke runs the final images read-only/non-root with isolated scratch/home and disposable persistent state. An isolated Docker network contains the real app, an untrusted client and a simulated verified edge. It checks anonymous/forged/duplicate UID rejection, Host/Origin, clean native-cookie flow, real client JS **executing in Chromium**, native `$events` readiness and bounded connection lifetime, real PTY, required profile imports and Tavern's protected source download. The test edge strips forged browser headers and injects a synthetic verified UID. This **does not test a real Authentik login/MFA/logout** or real model calls; validate those separately in your deployment. It prints only check summaries, never raw startup URLs, cookies, credentials, response bodies or boot logs. On failure, inspect sensitive diagnostics privately.

### One-time profile-lock bootstrap

If a new recipe does not yet have committed `docker/profiles/{web,tavern}/pnpm-lock.yaml`, a maintainer manually dispatches the **Bootstrap missing profile locks** workflow. It builds only the `profile-locks` export target and uploads the `profile-locks` artifact. Download it, review the generated web/Tavern locks, place them under `docker/profiles/web` and `docker/profiles/tavern`, and commit them. Generated locks use absolute `link:/opt/dsh/runtime/...` versions; `scripts/normalize-locks.mjs` enforces that and CI rejects relative link versions. Final CI/publishing deliberately fails until both locks are committed. This is an explicit bootstrap step, not silent dependency resolution during final builds.

### Publication policy

- Pull requests run source checks, tests, native amd64+arm64 builds and full final-image smoke on both. They receive no repository/App secrets, no `pull_request_target`, no package writes and no auto-merge.
- A release tag must equal `versions.json.release.<target>.tag` and point into `main`. The tag job builds only that target on native amd64 and arm64 runners, smokes each image, pushes the two staging manifests, and combines them into one version index. The two routes are independent; there is no floating `latest` and no branch publication.
- GHCR publication and GitHub release metadata both use a GitHub App installation token with Contents and Packages write. The App is the only write identity; the default `GITHUB_TOKEN` is used only for read-only checkout. First publication can create the new packages. No secret is a build arg or image layer.
- The index references the two tested architecture manifests. No BuildKit provenance or SBOM attestation is currently attached; verify deployments by digest.

Pin deployments to a digest and retain the previous digest plus volume snapshots. Supported compatibility is the explicitly pinned/tested distribution, not every upstream RC or arbitrary plugin combination. Upstream/SSO changes require new review, exact-hash patch rebasing where necessary, updated locks and the full smoke; there is no LTS/security-audit promise. Report bugs with image digest, architecture, redacted configuration and summary checks—never secrets.

## Sandbox caveats

Docker restrictions and the DSH agent sandbox protect different boundaries. Native PTY success does not prove Landlock/bubblewrap works on your kernel or container runtime. Test a real file/shell tool operation on your target host, including an attempted out-of-workspace write, before granting model access. DSH should fail when no supported sandbox is available. Do not hide failure with `--privileged`, a mounted Docker socket, broad host mounts, added capabilities, `danger-full-access` or a fake runner. Third-party plugins execute host-side code and are not isolated by the agent's workspace policy.

## License and corresponding source

Original project code remains **Apache-2.0** under the existing [LICENSE](LICENSE). DSH, market and MIT ecosystem notices are preserved in [NOTICE](NOTICE) and installed packages. This project is not a relicensing of its dependency tree.

**Tavern is AGPL-3.0-only.** Its original license and full modified source are retained at `/opt/dsh-tavern/apps/dsh-tavern`; the build/patch recipe is in `/opt/dsh/distribution-source` and [`docker/profiles/tavern/SOURCE-BUILD.txt`](docker/profiles/tavern/SOURCE-BUILD.txt). The Tavern UI includes an authenticated **Tavern source (AGPL-3.0)** download at `/distribution/source.tar.gz`, serving `/opt/dsh-source/tavern.tar.gz`, plus the exact distribution-source revision link. The archive contains source and build inputs, not user data or installed `node_modules`. Keep that source access available to your users and comply with the applicable distribution/network-source obligations when modifying or redistributing Tavern.
