# Build

Build context is the repository root; the Dockerfile is
`docker/Dockerfile`. The build-only inputs are separate from patches, the
forward-auth plugin, tests and deploy examples.

```bash
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

Use the native architecture matching the runner or host. CI builds
`linux/amd64` and `linux/arm64` on native GitHub runners.

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

## Source payload

The final images do **not** copy the repository root. `distribution-source`
contains only:

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

## Runtime paths and locks

The runtime is installed under `/opt/dsh/docker/runtime`, with
`/opt/dsh/runtime` as the stable alias. Profile locks use absolute
`link:/opt/dsh/runtime/...` specifiers. The build runs
`scripts/normalize-locks.mjs` for generated locks and refuses relative link
versions in committed locks.

If a new profile recipe has no committed lock, a maintainer manually dispatches
the **Bootstrap missing profile locks** workflow, downloads the `profile-locks`
artifact, reviews both files, commits them under `docker/profiles/*`, and then
rebuilds normally. Final CI deliberately fails until both locks are committed.

## Theme and route patches

Tavern routes and theme files are pinned by SHA-256 in `versions.json`.
`patches/tavern/patch-tavern.mjs` validates the theme package name/version and
the exact `lib/index.js` and `lib/client.js` hashes before invoking the
upstream theme helper. A changed upstream file is a build failure, not a
warning or a silent skip.

## Persistence defaults in the image

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
[data layout](data-layout.md); never mount test or source trees over `/opt`.

Do not add `latest`, publish host ports, or bake credentials, subject values,
edge keys or proxy private keys into build arguments or labels.
