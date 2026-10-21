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
| `web` | Final Web image: DSH Web + dshmarket + required forward-auth |
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

`test/`, `deploy/`, `.github/`, `.renovate/`, handoff notes and smoke/verify
scripts are excluded. The Tavern source archive is built from that same
whitelisted tree plus the complete Tavern checkout, so test and deployment
harnesses do not ship with the release image.

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

Do not add `latest`, publish host ports, or bake credentials, subject values,
edge keys or proxy private keys into build arguments or labels.

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
