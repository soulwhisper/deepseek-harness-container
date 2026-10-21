---
name: dsh-maintainer
description: >
  Use when changing, building, verifying or releasing this DeepSeek Harness
  container distribution. Records the Web/Tavern optional-asset boundary,
  user-removable plugin ownership, floating upstream inputs and CI verification.
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

## CI gating

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

- The Web image owns all **floating** optional assets:
  - `dsh-context`
  - Caveman skill seed
  - RTK OSS binary and RTK skill seed
- The Tavern image owns none of those floating assets. Its profile keeps the
  pinned Tavern distribution and ecosystem only.
- Tavern pinned ecosystem is immutable like forward-auth:
  - `versions.json` + committed lock pin the packages
  - the package set is installed into the immutable seed profile
  - `dshTavern.managedBundles` is manager-protected
  - pinned plugin rows are `management-required`
  - startup restores missing pinned manifest entries and seed links
  - `dsh-tavern-knock-knock` has no `dsh.bundle`; it is dependency-only
- `scripts/verify-runtime.mjs` must keep asserting the Tavern absences, the
  protected pinned bundles, and the Web assets.
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
| `dsh-tavern-comfy` | `dsh-tavern-image` | Bundle |
| `narrative-anchor` | `narrative-anchor` | Bundle |
| `dsh-better-sidebar` | `better-sidebar` | Bundle; has its own duplicate-mount guard |
| `dsh-tavern-knock-knock` | none | Dependency-only; no `dsh.bundle` |

Bundle IDs are unique. Keep the bundle order stable, especially around
`dsh-better-sidebar` and aggregate bundles. Do not move these packages to the
Web floating path or into the writable market set.

## Floating optional assets

Only the Web image has these; they are deliberately **not version-pinned** in
this repository:

| Asset | Source | Resolution |
| --- | --- | --- |
| `dsh-context` | npm `latest` | Installed as a normal package in the generated Web profile; runtime peers stay immutable links |
| Caveman skill | `JuliusBrussee/caveman` latest GitHub release tag | Resolve the tag, then fetch into the Web seed; upstream LICENSE and NOTICE retained |
| RTK | `rtk-ai/rtk` latest release, `rtk-oss-*` only | Verified and installed into the Web image |

Rules:

- Do not add versions for these three to `versions.json` or Renovate.
- Do not add `latest` image tags. The image digest is the reproducibility
  boundary for the floating bytes.
- Do not add these to committed profile locks; the Web build regenerates the
  in-image profile lock with `--no-frozen-lockfile`.
- Docker layers may cache old upstream bytes. Use a clean runner or bypass the
  relevant build cache when an explicit refresh is required.

## dsh-context ownership

- Install `dsh-context` from npm `latest` as a normal dependency in the
  generated Web profile, not in `/opt/dsh/runtime`.
- Add it to `dsh.profile.bundles`.
- Keep its `@deepseek-ai/dsh-session` and `@deepseek-ai/schemastery` peers as
  immutable runtime links.
- Verify the installed package still declares `dsh.bundle` and a compatible
  current DSH release.
- The manager must report `dsh-context` as `availability: profile`,
  `installed: true`, and `removable: true`.
- Only `@soulwhisper/dsh-forward-auth` and the Tavern
  `dshTavern.managedBundles` set are manager-protected. Do not add Web floating
  plugin installs to the runtime and do not reintroduce
  `patch-host.mjs --repair` just to support one.
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

Then push and use GitHub Actions. Do not claim image/test completion from source
inspection alone. Do not run a full local image build unless the user explicitly
asks for it.
