# Corresponding source

This page describes the complete modified Tavern source and the inputs needed to
rebuild the Tavern image. It is included in the source archive at
`distribution/docs/source-build.md`.

## What the archive contains

```text
tavern.tar.gz
  dsh-tavern/
    complete flizzywine/dsh-tavern source at
    9ddac3b55883ac7334c5b349368a56f2d6654c59
    (AGPL license, upstream lock, checked-in client output and the modified
    tavern-plugin/lib/http/routes.js public-Origin guard)
  distribution/
    docker/Dockerfile
    docker/runtime/ (manifest, workspace, lock)
    docker/profiles/ (web/tavern workspaces and committed locks,
                      distribution.patch.yml)
    patches/dsh/ patches/market/ patches/tavern/
    plugins/forward-auth/ (source, notices, licenses)
    scripts/entrypoint.sh, materialize-state.mjs, normalize-locks.mjs,
            materialize-profiles.mjs, floating-bundles.mjs, readiness.mjs,
            finalize-profile.mjs, link-tavern-core.mjs
    versions.json, package.json, pnpm-lock.yaml
    LICENSE, NOTICE, README.md, README.zh-CN.md
    docs/source-build.md, docs/regulations.md
```

The archive does **not** contain user state, credentials, `/workspace`, installed
`node_modules`, Git object databases, test/smoke harnesses, deploy examples, CI
workflows, general documentation, the repository `.agents/` maintainer skill or
the Web-only `docker/skills/` source payload. The image retains the Tavern
checkout at `/opt/apps/dsh-tavern` and the distribution inputs at
`/opt/dsh/distribution-source`; the authenticated route is
`/distribution/source.tar.gz` and `DSH_SOURCE_URL` identifies the distribution
commit.

The optional `dsh-context`, Caveman skill and RTK OSS binary are deliberately
floating upstream assets resolved only when building the **Web** image. Their
exact bytes are not pinned in this archive; the build recipe, upstream URLs and
the licenses retained in the Web image are included. Reproducing those exact
bytes requires the same upstream state or the published image digest. Tavern
does not activate or seed these optional assets; its archive keeps the shared
distribution build recipe only. See
[Build](build.md#floating-optional-assets).

## Rebuild from the archive

The pinned DSH/Tavern source graph is reproducible from the distribution commit
identified by `DSH_SOURCE_URL`; the three floating optional assets additionally
require their upstream state to be unchanged, or use the published digest:

```bash
docker buildx build -f docker/Dockerfile --target tavern \
  --build-arg IMAGE_REVISION=<that-40-hex-commit> .
```

The Dockerfile verifies the pinned Tavern commit, installs the committed locks
with pnpm 11.25.0, applies the exact-hash patches, retains the full linked source
and builds the archive. It installs no browser or desktop stack.

To rebuild from the already-modified source supplied in the archive without
redownloading the Tavern Git tree:

1. Use `distribution/` as the Docker build context.
2. Copy `dsh-tavern/` into `distribution/local-tavern-source/`.
3. In the `tavern-source` stage, replace the Git init/fetch/checkout and
   `patch-tavern.mjs` invocation with a `COPY local-tavern-source/
   /opt/apps/dsh-tavern/` step. The route file is already patched, so
   do not apply the route patch twice.
4. Apply the theme-font-limit helper exactly as invoked at the bottom of
   `distribution/patches/tavern/patch-tavern.mjs`; the route file is already
   patched. If you change the theme package, update and verify
   `versions.json.tavern.theme` first.
5. Keep the later stages, frozen source install and profile locks unchanged.

Removing `local-tavern-source/` after the build is fine; it is not part of the
image archive.

## Locks and maintainer operations

For deliberate dependency changes, regenerate the runtime lock with Node 24:

```bash
pnpm --dir docker/runtime install --lockfile-only --ignore-scripts
```

Regenerate profile locks from the exact in-image absolute source paths:

```bash
docker buildx build -f docker/Dockerfile \
  --target profile-locks --output type=local,dest=. .
```

Review and commit every changed lock before rebuilding. Startup performs no
package installation or network fetch. Dependency tarballs remain obtainable
from the sources and integrity hashes in the included locks.

## Licensing

Distribution Apache-2.0 licensing does not replace the Tavern AGPL license.
Retain the Tavern `LICENSE`, copyright notices, these source/build inputs and the
visible corresponding-source offer when redistributing Tavern. See
[Licensing](regulations.md).
