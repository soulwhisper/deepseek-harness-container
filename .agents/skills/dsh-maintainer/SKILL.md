---
name: dsh-maintainer
description: >
  Use when changing, building, verifying or releasing this DeepSeek Harness
  container distribution. Records the Web/Tavern optional-asset boundary,
  user-removable plugin ownership, build-resolved Web inputs and CI verification.
---
# DSH distribution maintenance

This is a repository-maintainer skill. Do not move it to `docker/skills/`; that
directory is seeded into the Web image as user-facing skills.

## Working policy

- If the user asks for an evaluation, report findings first and do not edit.
- If a change needs a judgment call, present the options and ask the user
  before proceeding.
- Prefer GitHub Actions for image builds and final-image smoke. Do not run a
  local image build unless the user explicitly asks.
- Local checks are limited to static and behavioral tests:
  `node scripts/verify.mjs` and `node --test test/*.test.mjs`.
- The authoritative image check is the GitHub Actions matrix for the changed
  image inputs, followed by `CI checks passed`.
- Deploy and compare published image digests, not mutable tags.

## Review findings

- Treat review comments from any provider (human, CodeRabbit, cubic, other
  bots) as leads, not facts. Re-read the cited code and its call path from a
  clean context before accepting or rejecting a finding.
- Classify each finding as valid, invalid or already handled. Do not presume
  code is broken because a reviewer suggested it, and do not dismiss it
  because a check passed.
- Fix valid findings; reply with evidence for invalid ones. Never apply a
  suggested patch mechanically when it changes an anchor, behavior or scope.
- Re-run the exact local gate plus the route/patch smoke after fixes; the
  latest CI run remains the authoritative image gate.

## CI gating and non-blocking workflow

- Do not block the next implementation step on CI completion.
- Check the latest run for the current HEAD once as the gate. If it failed,
  fix that failure. If it is still running, leave it running and continue with
  the remaining work.
- Never run local verify/tests as a substitute for the latest CI gate.
- CI keeps the workflow and required static check running for every same-repo
  PR, but skips the four image jobs when only docs, tests, scaffold, deploy
  examples or non-critical dotfiles changed.
- `.dockerignore` is an intentional image-input exception.
- Do not replace this with workflow-level `paths-ignore`: that can leave the
  required `CI checks passed` status missing and block the PR.
- For image-input changes, the matrix must show Web and Tavern on native amd64
  and arm64, including the final-image smoke; `ci-pass` must succeed.
- For docs/test/scaffold/dot-only changes, static verification plus a skipped
  image matrix is the expected success path.

## Web and Tavern boundary

- The Web image owns the **bundled** Web assets: `dsh-context`, `dsh-mnemon`,
  automation, IM, sidebar and SSH plugins, plus the Caveman skill seed and RTK
  OSS binary. `/data/memory` is durable user memory.
- The Tavern image owns none of those Web assets. Its profile keeps the native
  Tavern 3.2 bundle set only.
- Web and Tavern have independent Dockerfiles (`web.Dockerfile`,
  `tavern.Dockerfile`), runtime closures and final application stages
  (`web-application`, `tavern-application`). Do not reintroduce a shared
  Dockerfile, shared runtime/profile, or shared final stage.
- The Web profile seed approves only `ssh2` and `cpu-features` for the bundled
  SSH plugin. Owner-approved plugin build scripts are profile state:
  `materialize-state` must let existing approvals override seed defaults. Do
  not pre-approve a dependency just because a plugin is popular; one key
  authorizes every dependent plugin in that profile.
- Do not add row-level `disabled` patches for the DeepSeek account UI/login or
  message feedback. They did not work and are not part of the trust boundary;
  the edge remains Authentik/forward-auth, not a local login.
- Tavern native bundles are immutable like forward-auth:
  - `versions.json` + committed lock pin the packages
  - the native bundle set is installed into the immutable seed profile
  - `dshTavern.managedBundles` is manager-protected
  - pinned plugin rows are `management-required`
  - startup restores missing pinned manifest entries and seed links
- `scripts/verify-runtime.mjs` must keep asserting the Tavern absences, the
  protected native bundles, and the Web assets.
- The Tavern image does not inject a source notice into the index. The archive
  route remains `GET /distribution/source.tar.gz`; keep it authenticated and
  available. Do not reintroduce `tapIndex` notice injection.
- `patches/tavern/patch-tavern.mjs` applies upstream's
  `bin/theme-font-limit.mjs` helper. Upstream's `bin/profile-installation.mjs`
  also runs it after installing the host theme. This is upstream installation
  behavior, not a distribution-authored theme change; the container must
  replicate it because it builds the profile itself.
- The base `distribution-source` payload excludes `docker/skills/`. The Web
  final stage adds those sources only to the Web payload; Tavern has neither
  active skills nor skill source files.
- The repository maintainer skill under `.agents/` is excluded from the Docker
  build context and must never appear in either image.
- Do not add a distribution ecosystem list back. Keep Tavern on the native 3.2
  bundle set and do not move those packages into the Web bundled path.
- Do not add state-migration cleanup for removed ecosystem bundles. Each install
  is presumed clean; a generic obsolete-package list risks deleting user-owned
  packages. Keep `materialize-state` cleanup to the reviewed legacy auth and
  `dsh-tavern-comfy` cases already present.

## Immutable layout

- Tavern application root: `/opt/apps/dsh-tavern`.
- Runtime, seed and source archive: `/opt/dsh/{runtime,seed,source}`.
- Keep `/opt` entries short and explicit; only `/opt/dsh` and `/opt/apps`
  should remain at the top level.

## Tavern native bundle set

The Tavern profile uses the native `flizzywine/dsh-tavern` 3.2 bundles, not a
distribution-maintained ecosystem list:

| Package | Note |
| --- | --- |
| `dsh-better-sidebar` 0.28.0 | Native bundle; pinned patch for thread history |
| `dsh-dream-skin` | Native bundle linked from the source |
| `dsh-tavern-plugin` | Native bundle linked from the source |
| `dsh-tavern-remote` | Native bundle linked from the source |
| `dsh-asset-library` | Native bundle linked from the source |
| `dsh-tavern-stage` | Native bundle linked from the source |

`dsh-tavern-image` 3.4.0 is bundled inside the Tavern source and installed by
`scripts/seed-tavern-plugins.mjs` into Tavern `data/plugins`; it is not a
profile package. Do not add `dsh-tavern-comfy` or `dsh-tavern-image` back to the
profile. The authoritative version is
`tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json` at the
pinned commit; update this note and `NOTICE` when it changes.

Bundle IDs are unique. Keep the bundle order stable. Do not move these packages
to the Web bundled path or into the writable market set.

Upstream's `dsh-web-mobile` bundle and `dsh-pocket` dev dependency are
intentionally dropped from this container distribution. Do not add them back to
the Tavern profile, lock or workspace patch set.

The runtime pins `sharp 0.34.5` and `link-tavern-core.mjs` links it into the
Tavern source tree. Upstream's linked `dsh-asset-library` declares that native
dependency but its profile lock does not install it. Do not remove it without
replacing the native SVG/thumbnail decode path.

## Tavern version bumps and Renovate PRs

`versions.tavern.version` is the upstream **release tag** without the `v`, not
the upstream in-tree `package.json` version. Upstream publishes npm from the
tag (v3.2 → 3.2). Keep the release-tag identity for the image, OCI label and
release tag.

A Tavern bump is a coupled pin update. A version-only Renovate PR is
intentionally incomplete and must not be merged.

1. Resolve the tag to an exact commit and use the commit everywhere:
   ```bash
   git ls-remote --tags https://github.com/flizzywine/dsh-tavern.git 'refs/tags/vX.Y.Z*'
   git fetch --depth=1 https://github.com/flizzywine/dsh-tavern.git <40-hex-commit>
   git show <40-hex-commit>:tavern-plugin/lib/http/routes.js | sha256sum
   ```
2. Recompute `tavern.routesSha256` from that exact commit and re-check every
   anchor in `patches/tavern/patch-tavern.mjs`. Never weaken a hash or anchor to
   make a build pass.
3. Check `bin/theme-font-limit.mjs`, `config/dsh-compatibility.json`,
   the native bundle list in `package.json`, and
   `tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json`.
4. Update every coupled surface:
   - `versions.json`: `release.tavern.tag`, `tavern.version`, `commit`,
     `routesSha256`, `upstreamTag`
   - `docker/tavern.Dockerfile`: Tavern commit check and OCI label
   - `NOTICE`: Tavern version/source commit and bundled scene-image version
   - `docs/patches.md`, `docs/source-build.md`: source commit and patch list
   - `README.md`, `README.zh-CN.md`, `docs/index.md`, `docs/architecture.md`
   - `deploy/docker/compose.yaml`, `deploy/docker/.env.example`
   - `scripts/verify-runtime.mjs`: bundled scene-image version and archive
     assertions
5. Regenerate profile locks only when the dependency graph changed. The Tavern
   profile lock uses `link:/opt/apps/dsh-tavern/...`; a source-only bump normally
   produces no lock diff. Never hand-edit a lock.
6. Run `node scripts/verify.mjs` and `node --test test/*.test.mjs`. Because
   `versions.json` is an image input, CI must build and smoke Web and Tavern on
   native amd64 and arm64, and `CI checks passed` must succeed.
7. Merge, tag `tavern-<version>` on `main`, push the tag, and record the
   published multi-arch digest. Never reuse an existing release tag and never
   bump the Web `distribution` identity for a Tavern-only change.

### Renovate PR handling

- Renovate only rewrites `tavern.upstreamTag`; it cannot update the commit,
  hashes, locks, labels or docs. A version-only PR is expected to fail
  `scripts/verify.mjs`.
- Treat the PR as an upstream signal. Close it as superseded and open a manual
  `release/dsh-tavern-<version>` PR from `main`. Do not push to a `renovate/*`
  branch; a rebase can reset it.
- `type/patch` is not a risk assessment. Check the commit count, diffstat,
  bundled plugin version and compatibility allowlist before adopting it.
- Keep `automerge: false` and `review/required`; humans own the release tag.
- If an upstream tag moves, the pinned commit remains the source of truth. Do
  not change the Dockerfile to fetch a moving tag.

## Build-resolved Web inputs

Only the Web image has these. The Web runtime/profile has **no committed lock**:

| Asset | Source | Resolution |
| --- | --- | --- |
| Web plugins | npm releases pinned in `scripts/materialize-profiles.mjs` | Installed as normal profile packages; manager may remove them |
| Caveman skill | `JuliusBrussee/caveman` latest GitHub release tag | Resolve the tag, then fetch into the Web seed; upstream LICENSE and NOTICE retained |
| RTK | `rtk-ai/rtk` latest release, `rtk-oss-*` only | Verified and installed into the Web image |

Rules:

- Do not add `latest` image tags. The published Web digest is the
  reproducibility boundary.
- Do not add a committed Web profile/runtime lock; the Web build resolves the
  profile with pnpm.
- Keep the Tavern runtime and profile locks pinned and reviewed.
- Docker layers may cache old upstream bytes. Use a clean runner or bypass the
  relevant build cache when an explicit refresh is required.

## dsh-context ownership

- Install `dsh-context` as a normal dependency in the generated Web profile,
  not in `/opt/dsh/runtime`.
- Add it to `dsh.profile.bundles` and the Web profile compatibility exemption
  where its upstream `compatibility.dshReleases` map lacks the current release line.
- Keep its runtime peers as immutable links.
- Verify the installed package still declares `dsh.bundle` and a compatible
  current DSH release.
- The manager must report `dsh-context` as `availability: profile`,
  `installed: true`, and `removable: true`.
- Only `@soulwhisper/dsh-forward-auth` and the Tavern
  `dshTavern.managedBundles` set are manager-protected. Do not add Web plugin
  installs to the runtime and do not reintroduce `patch-host.mjs --repair`.
- Removal by the user is intended and must persist across restarts.

## Caveman skill

- Resolve the latest GitHub **release tag**; do not follow the moving `main`
  branch.
- Fetch `skills/caveman/SKILL.md` at that tag.
- Fetch and retain the tag's `LICENSE` and `NOTICE`.
- Validate the frontmatter name before accepting the file.
- It is a skill only; do not install the full Caveman CLI, hooks or companion
  binaries.

## RTK

- Use the **`rtk-oss-*` Apache-2.0 release asset**. Do not use the normal
  `rtk-*` asset: it links the BUSL-1.1 compression engine.
- Upstream permits free production use of the full edition, engine included.
  The reason to choose OSS is redistribution/license hygiene, not runtime cost.
- The OSS edition keeps the hook core and command filters. It omits
  `rtk pipeline`, PostToolUse compression and delegation tasks. The current
  bundled skill only wraps explicit `rtk <command>` calls, so the engine is not
  required.
- Verify the release checksum, install the binary at `/usr/local/bin/rtk`, and
  retain the upstream LICENSE at `/usr/local/share/rtk`.
- Keep the skill manual. Do not add automatic bash rewriting, hooks, or a
  provider-API proxy.

## Post-merge cleanup

After the PR is merged and the user authorizes cleanup:

1. Switch to the released base branch and synchronize:
   `git switch main`, then `git pull --ff-only`.
2. Review local branches already merged into `main`.
3. Delete only local stale branches after review. Do not delete remote branches.
4. Clean local build images, cached layers and transient artifacts; report what
   was removed and how much space was reclaimed.
5. Never delete remote branches, unmerged branches, user data or shared caches
   without explicit confirmation.

## Verification checklist

Local static checks only:

```text
node scripts/verify.mjs
node --test test/*.test.mjs
```

For a Tavern pin change, verify the route hash and gate anchors against a
throwaway checkout of the pinned commit:

```text
git -C /tmp/dsh-tavern-checkout show HEAD:tavern-plugin/lib/http/routes.js | sha256sum
```

`patches/tavern/patch-tavern.mjs` runs the same hash and anchor check during the
build. Then push and use GitHub Actions. Do not claim image/test completion from
source inspection alone. Do not run a full local image build unless the user
explicitly asks for it.
