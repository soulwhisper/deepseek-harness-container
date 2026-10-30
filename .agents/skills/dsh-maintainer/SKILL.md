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
- The Tavern image owns none of those Web assets. Its profile keeps the pinned
  Tavern distribution and ecosystem only.
- Web and Tavern have independent Dockerfiles (`web.Dockerfile`,
  `tavern.Dockerfile`), runtime closures and final application stages
  (`web-application`, `tavern-application`). Do not reintroduce a shared
  Dockerfile, shared runtime/profile, or shared final stage.
- The Web profile seed approves only `ssh2` and `cpu-features` for the bundled
  SSH plugin. Owner-approved plugin build scripts are profile state:
  `materialize-state` must let existing approvals override seed defaults. Do
  not pre-approve a dependency just because a plugin is popular; one key
  authorizes every dependent plugin in that profile.
- The distribution patch disables the account UI, account controller and
  assistant-message feedback rows. Keep them disabled by default; the edge
  remains Authentik/forward-auth, not a local login.
- Tavern pinned ecosystem is immutable like forward-auth:
  - `versions.json` + committed lock pin the packages
  - the package set is installed into the immutable seed profile
  - `dshTavern.managedBundles` is manager-protected
  - pinned plugin rows are `management-required`
  - startup restores missing pinned manifest entries and seed links
  - `dsh-tavern-knock-knock` has no `dsh.bundle`; it is dependency-only
- `scripts/verify-runtime.mjs` must keep asserting the Tavern absences, the
  protected pinned bundles, and the Web assets.
- The source notice is injected before `</body>` or `</html>` and carries the
  `data-dsh-distribution-source` marker. Do not go back to appending after
  `</html>` or relying on the first literal `</body>` only; built indexes may
  be uppercase or omit the body close.
- The base `distribution-source` payload excludes `docker/skills/`. The Web
  final stage adds those sources only to the Web payload; Tavern has neither
  active skills nor skill source files.
- The repository maintainer skill under `.agents/` is excluded from the Docker
  build context and must never appear in either image.
- Do not remove Tavern's own ecosystem packages when tightening this boundary.

## Immutable layout

- Tavern application root: `/opt/apps/dsh-tavern`.
- Runtime, seed and source archive: `/opt/dsh/{runtime,seed,source}`.
- Keep `/opt` entries short and explicit; only `/opt/dsh` and `/opt/apps`
  should remain at the top level.

## Tavern pinned ecosystem

These are pinned, not floating, and are installed only in the Tavern seed
profile:

| Package | Bundle ID | Note |
| --- | --- | --- |
| `dsh-tavern-wrongbook` | `dsh-tavern-wrongbook` | Bundle |
| `narrative-anchor` | `narrative-anchor` | Bundle |
| `dsh-better-sidebar` | `better-sidebar` | Bundle; has its own duplicate-mount guard |
| `dsh-tavern-knock-knock` | none | Dependency-only; no `dsh.bundle` |

`dsh-tavern-image` 3.1.1 is bundled inside the Tavern source and installed by
`scripts/seed-tavern-plugins.mjs` into Tavern `data/plugins`; it is not a
profile package. Do not add `dsh-tavern-comfy` or `dsh-tavern-image` back to
`versions.ecosystem`. The authoritative version is
`tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json` at the
pinned commit; update this note and `NOTICE` when it changes.

Bundle IDs are unique. Keep the bundle order stable, especially around
`dsh-better-sidebar` and aggregate bundles. Do not move these packages to the
Web bundled path or into the writable market set.

## Tavern version bumps and Renovate PRs

`versions.tavern.version` is the upstream **release tag** without the `v`, not
the upstream in-tree `package.json` version. Upstream publishes npm from the
tag (v3.1.3 → 3.1.3), while the checked-out tree may already declare a newer
integration version (v3.1.3 ships `package.json` 3.2.0). Keep the release-tag
identity for the image, OCI label and release tag.

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
3. Check `bin/theme-font-limit.mjs`, `config/dsh-compatibility.json` and
   `tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json`.
   The wrongbook host patches must also be re-checked; see below.
4. Update every coupled surface:
   - `versions.json`: `release.tavern.tag`, `tavern.version`, `commit`,
     `routesSha256`, `upstreamTag`
   - `docker/tavern.Dockerfile`: Tavern commit check, OCI label, and the
     `patches/wrongbook` invocation
   - `NOTICE`: Tavern version/source commit, bundled scene-image version and
     the vendored wrongbook patch notice
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
  hashes, locks, labels, docs or the wrongbook patches. A version-only PR is
  expected to fail `scripts/verify.mjs`.
- Treat the PR as an upstream signal. Close it as superseded and open a manual
  `release/dsh-tavern-<version>` PR from `main`. Do not push to a `renovate/*`
  branch; a rebase can reset it.
- `type/patch` is not a risk assessment. Check the commit count, diffstat,
  bundled plugin version and compatibility allowlist before adopting it.
- Keep `automerge: false` and `review/required`; humans own the release tag.
- If an upstream tag moves, the pinned commit remains the source of truth. Do
  not change the Dockerfile to fetch a moving tag.

### Wrongbook host-patch tool

`dsh-tavern-wrongbook` looks for its host-patch runner at
`<tavern data>/tools/mvu-api-test/patch-all.mjs` and runs `--apply` at startup.
That model assumes a writable desktop Tavern checkout. In this image
`/opt/apps/dsh-tavern` is immutable, so the supported patches are applied during
the image build and the same tool is seeded at startup when absent in Tavern
data only for status reporting.

Vendored subset: `patches/wrongbook/` from wrongbook v1.33.0 `debug/`.

- Included: MVU pure-API tests (`patch-mvu-api.mjs`) and timeout body retention
  (`patch-timeout-body.mjs`).
- Not included: the client helper/frame/workshop set, the two reasoning-channel
  patches, and the card-local `generate` patch. They target an older Tavern
  client/turn tree or user card data; `patch-all.mjs` lists them as not
  applicable.
- Build gate:
  `TAVERN_APP=/opt/apps/dsh-tavern node patches/wrongbook/patch-all.mjs --apply --strict --no-backup`
- Runtime seed: `/opt/dsh/seed/tavern-tools/mvu-api-test/` →
  `$DSH_HOME/profile-data/tavern/data/tools/mvu-api-test/` at startup when
  absent. Recognized upstream/image-managed copies are migrated or refreshed;
  a custom `patch-all.mjs` is preserved.
- Runtime `--apply` must be a no-op. Do not try to patch `/opt/apps` at runtime.
- On every Tavern bump, run the status/apply gate against the new source. If an
  anchor is unknown, port it deliberately or remove it from `PATCHES`; never
  ship a guessed anchor. Update `patches/wrongbook/SOURCE`, `NOTICE` and
  `docs/patches.md` when the subset changes.

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
  where its upstream `compatibility.dshReleases` map lacks the current alpha.
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

For a Tavern pin change, also preflight the wrongbook patches against a
throwaway checkout of the pinned commit:

```text
TAVERN_APP=/tmp/dsh-tavern-checkout node patches/wrongbook/patch-all.mjs --apply --strict
```

The Tavern image build runs the same gate against the immutable source. Then
push and use GitHub Actions. Do not claim image/test completion from source
inspection alone. Do not run a full local image build unless the user explicitly
asks for it.
