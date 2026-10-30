# Build and release

The build context is the repository root. Web and Tavern have independent,
non-inheriting recipes: `docker/web.Dockerfile` and `docker/tavern.Dockerfile`.
There is no shared `docker/Dockerfile`, no shared final stage, and no Web/Tavern
multi-stage dependency.

## Build locally

```bash
docker buildx build -f docker/web.Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/tavern.Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

Use the native architecture matching the runner or host. CI builds
`linux/amd64` and `linux/arm64` on native GitHub runners; there is no QEMU path.

## Targets

| Target | Result |
| --- | --- |
| `web` | Final Web image: DSH alpha + bundled Web plugins + required forward-auth |
| `tavern` | Final Tavern image: pinned source workspace + pruned profile + ecosystem |
| `web-application` | Web-only final-stage base; never shared with Tavern |
| `tavern-application` | Tavern-only final-stage base; never shared with Web |
| `profile-locks` | Maintainer-only Tavern lock export; the Web profile deliberately has no committed lock |
| `runtime-build` | Patched runtime dependency closure; Web alpha and Tavern rc.2 are separate |
| `distribution-source` | Image-specific whitelisted build/source payload |
| `tavern-source` | Pinned Tavern checkout plus exact-hash and wrongbook host patches |

## Authentication variants

There is no supported image that uses the Web UI without forward-auth. The
`web` and `tavern` targets always combine the patched Host with the required
gate; removing only the plugin leaves every HTTP and WebSocket route at 503.
Do not add a pass-through gate or disable the Host patch in a public image.

A user who specifically does not want this forward-auth adapter has two
unsupported options:

- Build an **upstream base** from `@deepseek-ai/dsh` without the host patch and
  without our authentication plugin. It uses the upstream launch-token URL and
  has no SSO; keep it on a private network and never treat it as a production
  identity boundary. This requires a separate Docker target, profile, readiness
  check, release tag and smoke coverage; the current image cannot be converted
  by deleting a bundle.
- Keep the patched Host and supply a **custom gate plugin** implementing the
  synchronous `http`/`upgrade` access-gate ABI. This is a plugin and must be
  installed as a required bundle with manager protection. It is not shipped or
  supported here.

Both options are application forks, not configuration switches. See
[Authentication](forward-auth.md) for the supported boundary.

## What ships in the image

The final images do **not** copy the repository root. The
`distribution-source` stage contains only:

- the selected Dockerfile, runtime manifest/workspace (and Tavern lock), the
  selected profile workspace/config, distribution patch;
- `patches/` exact-hash patch scripts;
- `plugins/forward-auth/` own plugin and notices;
- runtime/build scripts needed to reproduce or migrate the image;
- `versions.json`, root `package.json` and root lock;
- `LICENSE`, `NOTICE`, both READMEs;
- `docs/source-build.md` and `docs/regulations.md`.

`test/`, `deploy/`, `.github/`, `.renovate/`, `.agents/`, handoff notes and
smoke/verify scripts are excluded. The Tavern source archive is built from that
same whitelisted tree plus the complete Tavern checkout, so test and deployment
harnesses do not ship with the release image. The base source payload excludes
`docker/skills/`; the Web final stage adds those sources back only to the Web
payload, while Tavern has neither active skills nor skill source files.

## Bundled skills and plugins

Skill recommendations live under `docker/skills/` and are copied into the
**Web** image seed at `/opt/dsh/seed/skills`. Tavern does not copy that
directory and has no bundled Caveman, RTK or `dsh-context` assets. On first seed
or explicit state migration, missing bundles are copied into
`$DSH_HOME/skills`; users may edit or delete them. They are not immutable
runtime content. The final images export:

```text
DSH_AGENTS_HOME=/data/home/.agents
```

Add a skill as `<name>/SKILL.md` (or a flat `<name>.md`) with valid frontmatter,
rebuild the image, and restart. A new recommendation reaches existing state on
the next explicit distribution migration. Do not use `README.md` in that
directory because the provider treats top-level `.md` files as skill
candidates.

Bundled Web plugins (`dshmarket`, `dsh-context`, `dsh-mnemon`,
`@michengai/dsh-automation`, `@xmanrui/dsh-im`, `dsh-better-sidebar`,
`@linxin666/dsh-ssh`) are added to the Web profile recipe and installed at
image-build time. The Web runtime/profile has no committed lock: plugin updates
are resolved at build and the published digest is the reproducibility boundary.
Tavern remains pinned and manager-protected; only its lock is generated.
Existing state adopts the new Web distribution through the explicit
`DSH_STATE_MIGRATION=apply` migration, which merges managed bundles and
dependencies while preserving user plugins. Automatic plugin migration is
intentionally unsupported.

### Plugin build scripts

The Web profile seed approves only the native transport dependencies of the
bundled SSH plugin (`ssh2`, `cpu-features`). pnpm blocks every other dependency
lifecycle script by default; the market or `dsh plugin` reports blocked packages
and the owner approves them per profile. A profile's existing `allowBuilds`
entries are user state: a distribution migration preserves them and uses the
seed as the lower-precedence default. Do not pre-approve a package just because
a plugin is popular.

Tavern's pinned ecosystem is separate and remains manager-protected. Do not
pre-approve a package globally just because one plugin needs it: an
`allowBuilds` key authorizes every plugin in that profile that depends on the
same script owner.

### Upstream tracking

The Web image follows upstream DSH through Renovate's `dsh-web-upstream`
group. A DSH bump remains a coupled change: update `versions.json`, the Web
recipe/profile (and `webDsh`), exact-hash patch anchors and release
documentation together. The Web runtime/profile is intentionally build-resolved;
Tavern separately keeps its runtime/profile locks. Do not float DSH itself or
weaken a patch hash to make a bump pass.
The Tavern image follows `flizzywine/dsh-tavern` independently and keeps its
pinned source/theme pins.

Market-installed Web plugins are user-owned and track their upstream releases
through the plugin manager; their reviewed build approvals are preserved as
profile state. The Web plugin set is installed at image-build time.

### Build-resolved Web inputs

The Web runtime and profile deliberately have **no committed lock**. `versions.json`
pins the Web DSH alpha and `dshmarket`; the plugin recipe pins the initial
plugin releases used to build the image. Caveman and RTK are resolved from
their latest release tags at build time:

| Asset | Source | Build behavior |
| --- | --- | --- |
| Web plugins | npm releases pinned in the profile recipe | `dsh-context`, `dsh-mnemon`, automation, IM, sidebar and SSH are installed as normal profile packages; users may remove them through the manager |
| Caveman skill | `JuliusBrussee/caveman` latest GitHub release tag, `skills/caveman/SKILL.md` | Web only. The tag is resolved at build time, then fetched into `/opt/dsh/seed/skills/caveman`; upstream `LICENSE` and a `SOURCE` record are included. The moving `main` branch is not used |
| RTK binary | `rtk-ai/rtk` latest release, **`rtk-oss-*` Apache-2.0 edition** | Web only. Checksum-verified and installed at `/usr/local/bin/rtk`; the BUSL-1.1 asset is never used |

The Web profile is generated at image build with `pnpm install
--no-frozen-lockfile`; `/data/dsh` is the writable profile that manager operations
update. The published digest is the reproducibility boundary. Plugin code is
replaceable; `/data/memory` and the rest of `/data` are the durable boundary.
The manager protects only `@soulwhisper/dsh-forward-auth` on Web. Tavern's
pinned bundle set remains protected. `docker/profiles/web/compatibility.json`
contains exact package@version -> DSH-version exemptions only where an upstream
plugin still lacks an alpha release record; each exemption is a reviewed risk,
not a wildcard. Because the Web install is a Docker layer,
use a clean builder when you deliberately want to refresh build inputs; release
CI builds on clean runners.

The only required startup entry is `distribution-forward-auth`. On Tavern, the
pinned ecosystem listed in `dshTavern.managedBundles` is immutable in the same
sense as forward-auth: the manager refuses disable/remove operations and the
startup materializer restores missing manifest entries and seed links. The
pinned `dsh-tavern-knock-knock` package has no `dsh.bundle`; it remains an
immutable dependency only. Web-only bundled plugins and skills are removable
and are not protected by the manager.

The Tavern build also applies the supported `dsh-tavern-wrongbook` host patches
to the immutable source. The wrongbook runner is seeded at startup when absent
at `$DSH_HOME/profile-data/tavern/data/tools/mvu-api-test` for status reporting;
recognized upstream/image-managed copies are migrated and custom copies are
preserved. It must be a no-op at runtime because `/opt/apps` is read-only. The
build fails if a retained patch anchor no longer matches. See
[Upstream patches](patches.md#wrongbook-host-patches).

## Pins and locks

The runtime is installed under `/opt/dsh/docker/runtime`, with
`/opt/dsh/runtime` as the stable alias. The runtime manifest declares
`@soulwhisper/dsh-forward-auth` as `file:../../plugins/forward-auth`; pnpm
materializes that dependency as a symlink. The `runtime-build` stage removes
only that generated `node_modules` link, copies the reviewed
`plugins/forward-auth` bundle into its place, and asserts the expected patch
rows. The source plugin directory is not removed, and this is build-stage only.
Tavern profile locks use absolute `link:/opt/dsh/runtime/...` specifiers. The build
runs `scripts/normalize-locks.mjs` for generated locks and refuses relative link
versions in committed locks. The Web lock is generated only inside the image.

Only the Tavern profile has a committed lock. If it is missing, a maintainer
manually dispatches the **Bootstrap missing profile locks** workflow, downloads
the `profile-locks` artifact, reviews the Tavern file, commits it under
`docker/profiles/tavern/`, and rebuilds normally. The Web profile is generated
at build time and must not acquire a committed lock.

Tavern routes and theme files are pinned by SHA-256 in `versions.json`.
`patches/tavern/patch-tavern.mjs` validates the theme package name/version and
the exact `lib/index.js` and `lib/client.js` hashes before invoking the upstream
theme helper. A changed upstream file is a build failure, not a warning or a
silent skip. See [Upstream patches](patches.md).

## Runtime defaults

The final image sets:

```text
DSH_HOME=/data/dsh
HOME=/data/home
DSH_AGENTS_HOME=/data/home/.agents
DSH_BACKUP_ROOT=/backups
XDG_CACHE_HOME=/cache
XDG_CONFIG_HOME=/data/home/.config
XDG_DATA_HOME=/data/home/.local/share
npm_config_cache=/cache/npm
PNPM_HOME=/data/home/.local/share/pnpm
TMPDIR=/tmp
```

The entrypoint creates `/cache/dsh` and symlinks `$DSH_HOME/cache` and
`$DSH_HOME/logs` to their dedicated roots after state materialization. Mount
`/data`, `/workspace`, `/cache`, `/logs` and `/backups` as described in
[State and backup](data-layout.md); never mount test or source trees over `/opt`.

Except for the three build-time optional assets documented above, do not add
`latest` to pinned distribution dependencies, publish host ports, or bake
credentials, subject values, edge keys or proxy private keys into build
arguments or labels. The optional-asset dist-tags never become image tags.

## Release route

Only `web-<distribution>` and `tavern-<version>` tags publish. Each tag must match
`versions.json`, point into `main`, and pass a native amd64 and arm64 build plus
final-image smoke. Each build records the tested per-architecture manifest
digest; the combine job creates one multi-arch index from those digest-qualified
manifests, not from mutable staging tags. There is no floating tag, branch
publication or candidate `sha-` image.

A release tag is not proof that a state migration, community plugin or model
configuration is approved. Startup installs nothing. See
[Deployment](deploy.md) and [Operations](operations.md).
