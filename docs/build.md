# Build and release

The build context is the repository root; the Dockerfile is
`docker/Dockerfile`. Build-only inputs are separate from patches, the
forward-auth plugin, tests and deploy examples.

## Build locally

```bash
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

Use the native architecture matching the runner or host. CI builds
`linux/amd64` and `linux/arm64` on native GitHub runners; there is no QEMU path.

## Targets

| Target | Result |
| --- | --- |
| `web` | Final Web image: DSH Web + dshmarket + dsh-context + required forward-auth |
| `tavern` | Final Tavern image: pinned source workspace + pruned profile + ecosystem |
| `application` | Shared final-stage base before a profile is selected |
| `profile-locks` | Maintainer-only export of `docker/profiles/{web,tavern}/pnpm-lock.yaml` |
| `runtime-build` | Patched runtime dependency closure |
| `distribution-source` | Whitelisted build/source payload used by both images |
| `tavern-source` | Pinned Tavern checkout plus exact-hash patches |

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

- `docker/` build inputs: Dockerfile, runtime manifest/workspace/lock, profile
  workspaces and committed locks, distribution patch;
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

Bundled plugins that are part of the pinned distribution graph are not copied
by the entrypoint. Add them to the profile recipe in
`scripts/materialize-profiles.mjs` and the relevant `versions.json` pin,
regenerate both committed profile locks through the documented bootstrap
workflow, and bump the distribution identity. Existing state then adopts the
new distribution through the explicit `DSH_STATE_MIGRATION=apply` migration,
which merges managed bundles and dependencies while preserving user plugins.
Automatic plugin migration is intentionally unsupported.

### Floating optional assets

Three optional upstream assets are intentionally **not version-pinned** in
`versions.json`, the committed profile locks or Renovate. They are resolved at
image-build time and are tracked only by the published image digest:

| Asset | Source | Build behavior |
| --- | --- | --- |
| `dsh-context` | npm `latest` dist-tag | **Web only.** Installed as a normal package in the Web seed profile, so the manager owns it and users may remove it; its `dsh.bundle` and current-DSH compatibility declaration are verified before the image is published |
| Caveman skill | `JuliusBrussee/caveman` latest GitHub release tag, `skills/caveman/SKILL.md` | **Web only.** The tag is resolved at build time, then fetched into `/opt/dsh/seed/skills/caveman`; the upstream `LICENSE` and a `SOURCE` record are included. The moving `main` branch is not used |
| RTK binary | `rtk-ai/rtk` latest release, **`rtk-oss-*` Apache-2.0 edition** | **Web only.** Checksum-verified and installed at `/usr/local/bin/rtk`; the normal BUSL-1.1 asset is never used |

The Web build installs `dsh-context` from npm `latest` as a normal dependency
in the generated Web profile (`/opt/dsh/seed/profiles/web`), with immutable
runtime peer links for `@deepseek-ai/dsh-session` and
`@deepseek-ai/schemastery`. It leaves the committed profile lock unchanged and
regenerates the in-image lock with `--no-frozen-lockfile`. The package is never
installed into `/opt/dsh/runtime`, so host/manager patches are not rewritten and
no repair step is needed. On first seed it is copied to
`/data/dsh/profiles/web`, where the plugin manager owns it; users may remove it
like any market-installed package. Only `@soulwhisper/dsh-forward-auth` remains
manager-protected. A moved skill path, changed package identity, missing
release asset, absent `dsh.bundle` or unsupported current-DSH declaration fails
the build; it does not silently ship stale content. This is a deliberate
upstream-tracking tradeoff: reproducing the *exact* optional bytes requires the
same upstream state or the published digest, not just the repository commit.

The RTK skill is maintained under `docker/skills/rtk/SKILL.md`. It tells the
model when the proxy is appropriate and when to run the raw command. Neither
RTK nor Caveman is installed as an automatic hook or shell replacement.

Because the fetch and `latest` install are Docker layers, an ordinary repeated
build may reuse a cached layer and keep older optional bytes. Use a clean
builder or disable the cache for the `runtime-build` and `web-build` stages when
you explicitly want to refresh these upstream assets. Release CI builds on
clean runners, so the published digest reflects the resolutions of that run.

The only required startup entry is `distribution-forward-auth`. On Tavern, the
pinned ecosystem listed in `dshTavern.managedBundles` is immutable in the same
sense as forward-auth: the manager refuses disable/remove operations and the
startup materializer restores missing manifest entries and seed links. The
pinned `dsh-tavern-knock-knock` package has no `dsh.bundle`; it remains an
immutable dependency only. Web-only floating plugins and skills are removable
and are not protected by the manager.

## Pins and locks

The runtime is installed under `/opt/dsh/docker/runtime`, with
`/opt/dsh/runtime` as the stable alias. Profile locks use absolute
`link:/opt/dsh/runtime/...` specifiers. The build runs
`scripts/normalize-locks.mjs` for generated locks and refuses relative link
versions in committed locks.

If a new profile recipe has no committed lock, a maintainer manually dispatches
the **Bootstrap missing profile locks** workflow, downloads the `profile-locks`
artifact, reviews both files, commits them under `docker/profiles/*`, and then
rebuilds normally. Final CI deliberately fails until both locks are committed.

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

Only `web-<dsh-version>` and `tavern-<version>` tags publish. Each tag must match
`versions.json`, point into `main`, and pass a native amd64 and arm64 build plus
final-image smoke. Each build records the tested per-architecture manifest
digest; the combine job creates one multi-arch index from those digest-qualified
manifests, not from mutable staging tags. There is no floating tag, branch
publication or candidate `sha-` image.

A release tag is not proof that a state migration, community plugin or model
configuration is approved. Startup installs nothing. See
[Deployment](deploy.md) and [Operations](operations.md).
